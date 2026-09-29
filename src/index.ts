/**
 * dsh-auto-retry —— host 半（Node 端插件）
 *
 * 定位：与 dsh 内置重试插件（@deepseek-ai/dsh-llm-retry）互补的三层保障：
 *   1. 请求级补充重试：内置重试耗尽（或错误码不在内置默认集合）后，按用户配置的
 *      "触发情况清单"追加重试次数。主/子智能体可分别开关。
 *   2. 回合级自动继续：回合（turn）终局失败后，延迟 N 秒自动向会话发送"继续"。
 *      带连续失败熔断，用户手动停止（cancel cause = user）永不自动继续。
 *   3. 无响应看门狗：主智能体 running 且超过 N 秒会话完全无活动（无流帧、无
 *      durable 事件）→ 主动 cancel（cause: hook）→ 交给第 2 层自动继续恢复。
 *
 * 运行时依赖：仅 @deepseek-ai/schemastery（config 校验）。
 * 事件契约与版本（0.1.7-alpha.1）的核对结论见工作目录 DESIGN.md。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdir as mkdirAsync, readFileSync, rename as renameAsync, unlink as unlinkAsync, writeFile as writeFileAsync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import Schema from '@deepseek-ai/schemastery'

const mkdir = promisify(mkdirAsync)
const rename = promisify(renameAsync)
const unlink = promisify(unlinkAsync)
const writeFile = promisify(writeFileAsync)

/* ============================================================
 * 一、本地类型声明（最小化，只声明插件实际用到的字段）
 * ============================================================ */

/** LLM 失败描述（对齐 dsh-llm 的 LlmFailure） */
interface LlmFailure {
  message: string
  code?: string
  status?: number
  providerRetryAfterMs?: number
  [key: string]: unknown
}

/** agent/request-error 事件载荷（对齐 dsh-agent runtime-types） */
interface RequestErrorPayload {
  agent: AgentLike
  turn: number
  step: number
  provider: string
  failure: LlmFailure
  retryPolicy: unknown
  signal: AbortSignal
}

/** 插件用到的 Agent 能力子集（对齐 dsh-agent-loop ReactLoopAgent） */
interface AgentLike {
  id: string
  status: 'idle' | 'running'
  session: {
    id: string
    header: { origin?: string; parentSession?: string; delegationDepth?: number }
    append(type: string, data: unknown): unknown
  }
  followup(message: UserMessageLike): void
  cancel(cause: { kind: string; reason?: string }, options?: { keepInbox?: boolean }): void
}

/** 用户消息（手工构造，与 createUserMessage 产物形状一致） */
interface UserMessageLike {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' }
}

/** 会话 durable 事件（对齐 dsh-session SessionEvent） */
interface SessionEventLike {
  type: string
  data: any
}

/** 触发情况规则（对齐 DESIGN.md §3/§4） */
interface RetryRule {
  code: string
  enabled: boolean
  maxRetries: number
}

/** volatile 配置访问器（cordis Volatile 的最小形状） */
interface Volatile<T> {
  get(): T
}

/**
 * host 端配置形状（读取视角，全部为纯值）。
 * loader 对 volatile 字段的包装层级随容器/叶子标记而不同，
 * 运行时统一用 unwrapDeep() 解包成该形状后再使用。
 */
interface HostConfig {
  enabled: boolean
  notify: boolean
  rules: RetryRule[]
  mainAgent: {
    requestRetry: boolean
    autoContinue: boolean
    continueDelayMs: number
    maxConsecutive: number
    continueMessage: string
    idleWatchdog: boolean
    idleTimeoutMs: number
    continueOnMaxTokens: boolean
  }
  subAgent: {
    requestRetry: boolean
  }
  backoff: {
    intervalMode: 'exponential' | 'fixed'
    initialDelayMs: number
    maxDelayMs: number
    fixedDelayMs: number
  }
}

/**
 * 深度解包配置：把 Volatile 访问器（任意层级、任意嵌套组合）递归替换为纯值快照。
 * 每次事件处理开始时调用一次，之后以纯对象方式读配置。
 */
function unwrapDeep<T>(value: unknown): T {
  if (value && typeof (value as Volatile<unknown>).get === 'function') {
    return unwrapDeep((value as Volatile<unknown>).get())
  }
  if (Array.isArray(value)) return value.map((item) => unwrapDeep(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = unwrapDeep(item)
    }
    return out as T
  }
  return value as T
}

/* ============================================================
 * 二、配置 schema（所有叶子字段 .volatile()：设置页只允许写 volatile 路径）
 * ============================================================ */

/** 触发情况默认清单（顺序固定，client UI 按此顺序渲染） */
const DEFAULT_RULES: RetryRule[] = [
  { code: 'RATE_LIMIT', enabled: true, maxRetries: 2 },
  { code: 'SERVER', enabled: true, maxRetries: 2 },
  { code: 'TIMEOUT', enabled: true, maxRetries: 2 },
  { code: 'EMPTY_RESPONSE', enabled: true, maxRetries: 1 },
  { code: 'TRANSPORT', enabled: true, maxRetries: 3 },
  { code: 'UNKNOWN', enabled: true, maxRetries: 2 },
  { code: 'HTTP_4XX', enabled: false, maxRetries: 1 },
  { code: 'ABORTED', enabled: false, maxRetries: 1 },
]

/** 单条规则 schema */
const ruleSchema = Schema.object({
  code: Schema.string().required(),
  enabled: Schema.boolean().default(false),
  maxRetries: Schema.number().step(1).min(0).max(20).default(1),
})

/** 插件配置 schema。
 *  volatile 规则：volatile 字段必须是固定对象路径上的叶子，叶子不能再嵌套在 volatile 容器里。
 *  因此 mainAgent/subAgent/backoff/rules 以整组（容器/数组）为 volatile 单元，
 *  设置页按 ['mainAgent'] 等路径整组读写，host 端经 unwrapDeep() 解包读取。 */
export const Config = Schema.object({
  // 总开关
  enabled: Schema.boolean().default(true).volatile(),
  // 实时通知：重试/继续/看门狗事件推送到 Web UI 右上角弹窗
  notify: Schema.boolean().default(true).volatile(),
  // 触发情况清单（client 端整组读写）
  rules: Schema.array(ruleSchema).default(DEFAULT_RULES).volatile(),
  // 主智能体（整组 volatile）
  mainAgent: Schema.object({
    requestRetry: Schema.boolean().default(true),
    autoContinue: Schema.boolean().default(true),
    continueDelayMs: Schema.number().step(1).min(0).max(600_000).default(5_000),
    maxConsecutive: Schema.number().step(1).min(1).max(50).default(5),
    continueMessage: Schema.string().default('继续'),
    idleWatchdog: Schema.boolean().default(false),
    idleTimeoutMs: Schema.number().step(1).min(30_000).max(600_000).default(180_000),
    // 回合因输出长度截断（max-tokens）时也自动继续；截断同样计入熔断计数
    continueOnMaxTokens: Schema.boolean().default(false),
  }).volatile(),
  // 子智能体（整组 volatile；子智能体失败由主智能体接手，不做自动继续）
  subAgent: Schema.object({
    requestRetry: Schema.boolean().default(true),
  }).volatile(),
  // 补充重试的间隔参数（整组 volatile）
  backoff: Schema.object({
    // exponential：指数退避（initial*2^n，上限 maxDelay）；fixed：每次固定等待 fixedDelay
    intervalMode: Schema.union(['exponential', 'fixed']).default('exponential'),
    initialDelayMs: Schema.number().step(1).min(100).max(60_000).default(1_000),
    maxDelayMs: Schema.number().step(1).min(1_000).max(300_000).default(30_000),
    fixedDelayMs: Schema.number().step(1).min(100).max(600_000).default(5_000),
  }).volatile(),
})

/* ============================================================
 * 三、插件主体
 * ============================================================ */

export const name = 'auto-retry'

/** 依赖服务：agents 注册表（followup / cancel / status 判定都需要它） */
export const inject = ['agents']

/**
 * 插件入口。注册三层能力的全部事件监听；所有运行时状态（计数桶、
 * 熔断计数、待发定时器、看门狗定时器）都在本函数作用域内，随插件卸载一并清理。
 */
export function apply(ctx: any, config: unknown): void {
  const log = ctx.logger('auto-retry')
  const agents = ctx.agents

  // 配置读取入口：每次使用时解包一次，保证拿到 volatile 热更新后的最新值
  const cfg = () => unwrapDeep<HostConfig>(config)

  /* ---------- 运行时状态 ---------- */

  // 请求级补充重试计数桶：sessionId → turn → ruleCode → 已重试次数
  const retryBuckets = new Map<string, Map<number, Map<string, number>>>()
  // 自动继续熔断计数：sessionId → 连续终局失败次数（回合 completed 清零）
  const continueStreaks = new Map<string, number>()
  // 待发送的自动继续定时器：sessionId → timer（防同一会话重复排队）
  const pendingContinues = new Map<string, ReturnType<typeof setTimeout>>()
  // 当前运行中的主智能体：供 volatile 配置更新时对账看门狗。
  const runningAgents = new Map<string, AgentLike>()
  // 插件卸载信号：终止所有正在等待的补充重试。
  const lifetime = new AbortController()
  let disposed = false
  // 看门狗定时器：sessionId → timer 与使用的阈值。
  const watchdogTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; timeoutMs: number }>()

  /* ---------- 通用工具 ---------- */

  /** 判断 agent 是否子智能体（durable 会话头 origin === 'subagent'） */
  function isSubagent(agent: AgentLike): boolean {
    return agent?.session?.header?.origin === 'subagent'
  }

  /** 构造用户消息（与 dsh-llm createUserMessage 产物形状一致：随机 id + user 来源） */
  function buildUserMessage(text: string): UserMessageLike {
    return {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }
  }

  /** 可取消延迟：signal abort 或 dispose 时立即返回 false */
  function cancellableDelay(ms: number, ...signals: AbortSignal[]): Promise<boolean> {
    return new Promise((resolve) => {
      if (signals.some((signal) => signal.aborted)) return resolve(false)
      const timer = setTimeout(() => { cleanup(); resolve(true) }, ms)
      const onAbort = () => { cleanup(); resolve(false) }
      function cleanup() {
        clearTimeout(timer)
        for (const signal of signals) signal.removeEventListener('abort', onAbort)
      }
      for (const signal of signals) signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Cancel a pending continuation before the user starts a new turn. */
  function cancelPendingContinue(sessionId: string): void {
    const timer = pendingContinues.get(sessionId)
    if (!timer) return
    clearTimeout(timer)
    pendingContinues.delete(sessionId)
  }

  /** Cancel a pending continuation when user input enters the durable inbox. */
  function cancelPendingContinueOnUserMessage(sessionId: string, event: SessionEventLike): void {
    if (event.type !== 'agent/inbox/spliced' || !Array.isArray(event.data?.inserted)) return
    if (event.data.inserted.some((message: UserMessageLike) => message?.source?.kind === 'user')) {
      cancelPendingContinue(sessionId)
    }
  }

  /** 限幅工具 */
  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  /* ============================================================
   * 统计记录器：记录全部重试（含内置）/自动继续/看门狗事件，
   * 持久化到 <DSH_HOME>/auto-retry-stats.json，供看板查询。
   * ============================================================ */

  /** 统计事件（记录原始事件，聚合在查询时做） */
  interface StatEvent {
    ts: number
    kind: 'retry' | 'continue' | 'watchdog' | 'turn-end'
    sessionId: string
    turn?: number
    provider?: string
    model?: string
    code?: string
    attempt?: number
    maxRetries?: number
    delayMs?: number
    source?: 'built-in' | 'supplemental'
    outcome?: string
  }

  /** 统计文件路径：<DSH_HOME>/auto-retry-stats.json */
  const statsPath = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'auto-retry-stats.json')
  const STATS_MAX_EVENTS = 5000

  /** 内存中的事件列表（启动时从磁盘加载） */
  const statEvents: StatEvent[] = []
  let statsDirty = false
  let statsRevision = 0
  let statsFlushPromise: Promise<void> = Promise.resolve()
  let statsFlushTimer: ReturnType<typeof setTimeout> | undefined

  /** 启动时加载历史统计（损坏/缺失则从空开始） */
  try {
    if (existsSync(statsPath)) {
      const parsed = JSON.parse(readFileSync(statsPath, 'utf8'))
      if (Array.isArray(parsed?.events)) {
        const validEvents = parsed.events.filter((event: unknown): event is StatEvent => {
          if (!event || typeof event !== 'object') return false
          const item = event as Partial<StatEvent>
          return typeof item.ts === 'number'
            && Number.isFinite(item.ts)
            && typeof item.sessionId === 'string'
            && ['retry', 'continue', 'watchdog', 'turn-end'].includes(String(item.kind))
        })
        statEvents.push(...validEvents.slice(-STATS_MAX_EVENTS))
      }
    }
  } catch (error) {
    log.warn('统计文件加载失败（忽略，从空开始）：%s', error instanceof Error ? error.message : String(error))
  }

  /** 安排一次防抖落盘；卸载后不再新增后台写入任务。 */
  function scheduleStatsFlush(): void {
    if (disposed) return
    if (statsFlushTimer) clearTimeout(statsFlushTimer)
    statsFlushTimer = setTimeout(() => { void flushStats() }, 5000)
  }

  /** 记录一条统计事件；debounce 5s 落盘，滚动保留最近 5000 条 */
  function recordStat(event: StatEvent): void {
    statEvents.push(event)
    if (statEvents.length > STATS_MAX_EVENTS) statEvents.splice(0, statEvents.length - STATS_MAX_EVENTS)
    statsDirty = true
    statsRevision += 1
    scheduleStatsFlush()
    // 实时通知：总开关与通知开关都开着时，向所有 SSE 订阅者广播该事件
    const conf = cfg()
    if (conf.enabled && conf.notify) broadcastSSE(event)
  }

  /* ---------- SSE 实时推送（右上角通知的数据通道，模式照抄 dsh-client-hmr 先例） ---------- */

  /** 当前在线的 SSE 订阅连接 */
  const sseClients = new Set<{ write(chunk: string): unknown; end(): unknown }>()

  /** 向所有订阅者广播一条事件；写失败的连接直接剔除 */
  function broadcastSSE(event: StatEvent): void {
    if (sseClients.size === 0) return
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const res of [...sseClients]) {
      try {
        res.write(frame)
      } catch {
        sseClients.delete(res)
      }
    }
  }

  /** 串行原子写入统计快照；失败时保留 dirty 状态供后续重试或卸载落盘。 */
  async function flushStats(): Promise<void> {
    statsFlushTimer = undefined
    const pending = statsFlushPromise.then(async () => {
      if (!statsDirty) return
      const revision = statsRevision
      const snapshot = JSON.stringify({ version: 1, events: statEvents })
      const temporaryPath = `${statsPath}.${process.pid}.${revision}.tmp`
      try {
        await mkdir(dirname(statsPath), { recursive: true })
        await writeFile(temporaryPath, snapshot, 'utf8')
        await rename(temporaryPath, statsPath)
        if (statsRevision === revision) statsDirty = false
      } catch (error) {
        statsDirty = true
        log.warn('统计文件写入失败：%s', error instanceof Error ? error.message : String(error))
      } finally {
        try { await unlink(temporaryPath) } catch { /* 临时文件可能已重命名或未创建 */ }
      }
    })
    statsFlushPromise = pending
    await pending
    if (statsDirty && !disposed && !statsFlushTimer) scheduleStatsFlush()
  }

  /** 按天数范围过滤事件（days=0 表示全部） */
  function filterEventsByDays(days: number): StatEvent[] {
    if (!Number.isFinite(days) || days <= 0) return statEvents
    const since = Date.now() - days * 86_400_000
    return statEvents.filter((event) => event.ts >= since)
  }

  /**
   * 会话当前模型跟踪：assistant/message 的 data.message.source.{provider,model} 是
   * 每回合实际路由的权威来源（llm/retry 事件本身不含 model）。统计事件记录最近已知值。
   */
  const sessionModels = new Map<string, { provider?: string; model?: string }>()

  /* ============================================================
   * 第 1 层：请求级补充重试（agent/request-error waterfall）
   * 注册顺序在内置 llm-retry 之后（外层是它）：
   *   - 内置可重试且预算未尽 → 内置自行处理，不会到达本监听器；
   *   - 内置预算耗尽或错误码不在内置集合 → next() 放行到本监听器，按规则追加。
   * ============================================================ */
  ctx.on('agent/request-error', async (payload: RequestErrorPayload, next: () => Promise<{ kind: 'retry' } | undefined>) => {
    let delegated = false
    let abandoned = false
    let delegatedPromise: Promise<{ kind: 'retry' } | undefined> | undefined
    const delegate = () => {
      delegated = true
      return delegatedPromise ??= Promise.resolve().then(next)
    }
    let bucket: Map<string, number> | undefined
    let bucketRule: string | undefined
    let used = 0
    let retryCommitted = false
    try {
      const conf = cfg()
      // 总开关关闭 → 完全委托下游
      if (!conf.enabled) return delegate()
      // 请求 signal 已 abort（用户停止/外部取消）→ 绝不重试
      if (payload.signal.aborted || lifetime.signal.aborted) return delegate()

      const failure = payload.failure ?? {}
      const code = failure.code ?? 'UNKNOWN'
      const rule = matchRule(conf.rules, code)
      // 无规则 / 未勾选 / 次数为 0 → 委托下游
      if (!rule || !rule.enabled || rule.maxRetries <= 0) return delegate()

      // 主/子智能体分别开关
      const sub = isSubagent(payload.agent)
      const scopeOn = sub ? conf.subAgent.requestRetry : conf.mainAgent.requestRetry
      if (!scopeOn) return delegate()

      // 计数桶：同一 (会话, 回合, 规则) 共享一个预算
      const sessionId = payload.agent.session.id
      const turns = retryBuckets.get(sessionId) ?? new Map<number, Map<string, number>>()
      retryBuckets.set(sessionId, turns)
      bucket = turns.get(payload.turn) ?? new Map<string, number>()
      turns.set(payload.turn, bucket)
      bucketRule = rule.code
      used = bucket.get(rule.code) ?? 0
      if (used >= rule.maxRetries) {
        log.info('补充重试预算已用尽（%s 第 %d 次），放行终局', code, used)
        return delegate()
      }
      bucket.set(rule.code, used + 1)

      // 重试间隔：上游 Retry-After 优先；否则按配置的模式——指数退避或固定间隔（均加 ±10% 抖动）
      const backoff = conf.backoff
      const base = failure.providerRetryAfterMs != null && Number.isFinite(failure.providerRetryAfterMs)
        ? clamp(failure.providerRetryAfterMs, 100, backoff.maxDelayMs)
        : backoff.intervalMode === 'fixed'
          ? backoff.fixedDelayMs
          : Math.min(backoff.initialDelayMs * 2 ** used, backoff.maxDelayMs)
      const delayMs = Math.round(base * (0.9 + Math.random() * 0.2))

      const retryId = `auto-${sessionId.slice(0, 8)}-${payload.turn}-${payload.step}-${code}-${used + 1}`
      // 先写 durable 重试排程事件（与内置 llm/retry 事件同形，会话日志可审计）
      payload.agent.session.append('llm/retry', {
        retryId,
        turn: payload.turn,
        step: payload.step,
        provider: payload.provider,
        mode: 'normal',
        policyKey: 'auto-retry',
        retry: used + 1,
        maxRetries: rule.maxRetries,
        delayMs,
        failure,
      })
      log.info('计划补充重试：%s（%d/%d），%d ms 后重发', code, used + 1, rule.maxRetries, delayMs)

      // 等待期间被取消 → 放弃接管，失败走终局（可能由自动继续层接手）
      if (!await cancellableDelay(delayMs, payload.signal, lifetime.signal)) {
        abandoned = true
        return undefined
      }

      payload.agent.session.append('llm/retry-started', {
        retryId,
        turn: payload.turn,
        step: payload.step,
        retry: used + 1,
      })
      // 接管：让 agent loop 在当前回合内重发请求
      retryCommitted = true
      return { kind: 'retry' }
    } catch (error) {
      // 监听器自身异常不允许破坏请求失败路径；发生在排程之后时回滚预算。
      if (delegated) throw error
      if (!retryCommitted && bucket && bucketRule !== undefined) bucket.set(bucketRule, used)
      if (abandoned) return undefined
      log.warn('补充重试监听器异常：%o', error)
      return delegate()
    }
  })

  /** 按错误码匹配规则：精确匹配；HTTP_4XX 额外兜住 HTTP_ 前缀的其他状态码 */
  function matchRule(rules: RetryRule[], code: string): RetryRule | undefined {
    for (const rule of rules) {
      if (!rule?.code) continue
      if (rule.code === code) return rule
      if (rule.code === 'HTTP_4XX' && code.startsWith('HTTP_')) return rule
    }
    return undefined
  }

  /* ============================================================
   * 第 2 层：回合级自动继续 + 看门狗活动信号 + 统计记录（session/event）
   * ============================================================ */
  ctx.on('session/event', (session: { id: string; header?: { origin?: string } }, event: SessionEventLike) => {
    // 用户在自动继续等待期间发来消息，当前自动任务应让位。
    cancelPendingContinueOnUserMessage(session.id, event)
    // 看门狗：任何 durable 事件都算会话活动，重置对应计时器
    if (watchdogTimers.has(session.id)) armWatchdog(session.id)

    // 会话当前模型跟踪：assistant/message 携带实际使用的 provider/model
    if (event?.type === 'assistant/message') {
      const source = event.data?.message?.source
      if (source?.provider || source?.model) {
        sessionModels.set(session.id, { provider: source.provider, model: source.model })
      }
      return
    }

    // 统计：捕获所有 llm/retry durable 事件——内置 llm-retry 与本插件的补充重试都会走到这里，
    // 用 policyKey 区分来源（本插件写 'auto-retry'，内置是 provider 策略标识）
    if (event?.type === 'llm/retry') {
      const data = event.data ?? {}
      const knownModel = sessionModels.get(session.id)
      recordStat({
        ts: Date.now(),
        kind: 'retry',
        sessionId: session.id,
        turn: data.turn,
        provider: data.provider ?? knownModel?.provider,
        model: knownModel?.model,
        code: data.failure?.code,
        attempt: data.retry,
        maxRetries: data.maxRetries,
        delayMs: data.delayMs,
        source: data.policyKey === 'auto-retry' ? 'supplemental' : 'built-in',
      })
      return
    }

    if (event?.type !== 'turn/end') return
    const reason = event.data?.reason ?? {}
    const sessionId = session.id
    const turn = event.data?.turn
    if (typeof turn === 'number') clearRetryBucketsOfTurn(sessionId, turn)

    // 统计：回合终局结果（供"平均几次重试成功"按 (session, turn) 聚合）
    const knownModel = sessionModels.get(sessionId)
    recordStat({
      ts: Date.now(),
      kind: 'turn-end',
      sessionId,
      turn: event.data?.turn,
      provider: knownModel?.provider,
      model: knownModel?.model,
      code: reason.kind === 'error' ? reason.error?.code : reason.kind === 'aborted' ? 'ABORTED' : undefined,
      outcome: reason.kind ?? 'unknown',
    })

    if (reason.kind === 'completed') {
      // 回合成功：清熔断计数。
      continueStreaks.set(sessionId, 0)
      return
    }

    if (reason.kind === 'error') {
      scheduleContinue(sessionId, reason.error?.code, event.data?.turn)
      return
    }

    if (reason.kind === 'max-tokens') {
      // 输出因长度截断：默认不管；用户开启 continueOnMaxTokens 时自动继续（计入熔断）
      if (cfg().mainAgent.continueOnMaxTokens) scheduleContinue(sessionId, 'MAX_TOKENS', event.data?.turn)
      return
    }

    if (reason.kind === 'aborted') {
      // 只有看门狗自己的 hook 取消才自动继续；
      // user（用户手动停止）/ parent / disposed / legacy 一律不继续
      if (reason.reason?.kind === 'hook' && cfg().mainAgent.idleWatchdog) {
        scheduleContinue(sessionId, 'ABORTED', event.data?.turn)
      }
      return
    }
  })

  /** 回合终局后清理该回合的重试计数桶，避免 Map 无界增长 */
  function clearRetryBucketsOfTurn(sessionId: string, turn: number): void {
    const turns = retryBuckets.get(sessionId)
    turns?.delete(turn)
    if (turns?.size === 0) retryBuckets.delete(sessionId)
  }

  /** Remove every retry bucket owned by one session. */
  function clearRetryBucketsOfSession(sessionId: string): void {
    retryBuckets.delete(sessionId)
  }

  /**
   * 排定一次自动继续：延迟后向会话发送"继续"用户消息（开启新回合）。
   * 防御：总开关/子开关/熔断/重复排队/到期时状态复核，全部通过才发送。
   */
  function scheduleContinue(sessionId: string, errorCode: string | undefined, turn?: number): void {
    // 仅主智能体（子智能体 one-shot 不可继续；continuable 由主智能体接手）
    const agent = agents.get(sessionId)
    if (!agent || isSubagent(agent)) return
    const conf = cfg()
    if (!conf.enabled || !conf.mainAgent.autoContinue) return

    // 连续失败熔断：达到上限后停止，warn 提示；回合成功后自动清零恢复
    const streak = continueStreaks.get(sessionId) ?? 0
    const maxConsecutive = conf.mainAgent.maxConsecutive
    if (streak >= maxConsecutive) {
      log.warn('会话 %s 已连续失败 %d 次（上限 %d），停止自动继续', sessionId.slice(0, 8), streak, maxConsecutive)
      return
    }

    // 已有排定任务时不重复排队
    if (pendingContinues.has(sessionId)) return

    const delayMs = conf.mainAgent.continueDelayMs
    const timer = setTimeout(async () => {
      pendingContinues.delete(sessionId)
      try {
        // 到期复核：插件仍在、agent 仍在注册表且已回到 idle（用户手动发消息会使其 running，此时放弃）
        const live = agents.get(sessionId)
        if (!live || live !== agent) return
        const now = cfg()
        if (!now.enabled || !now.mainAgent.autoContinue) return
        if (live.status !== 'idle') {
          log.info('会话 %s 延迟期间已有新活动，跳过自动继续', sessionId.slice(0, 8))
          return
        }
        const nextStreak = (continueStreaks.get(sessionId) ?? 0) + 1
        continueStreaks.set(sessionId, nextStreak)
        const message = buildUserMessage(now.mainAgent.continueMessage)
        live.followup(message)
        recordStat({
          ts: Date.now(),
          kind: 'continue',
          sessionId,
          turn: turn,
          code: errorCode,
          source: 'supplemental',
          outcome: `streak=${nextStreak}`,
        })
        log.info('会话 %s 回合失败（%s），已自动发送继续（连续第 %d 次）', sessionId.slice(0, 8), errorCode ?? 'unknown', nextStreak)
      } catch (error) {
        log.warn('自动继续发送失败：%o', error)
      }
    }, delayMs)
    pendingContinues.set(sessionId, timer)
  }

  /* ============================================================
   * 第 3 层：无响应看门狗（agent/status + agent/assistant-stream）
   * ============================================================ */
  ctx.on('agent/inbox/inserted', (payload: { agent: AgentLike; message: UserMessageLike }) => {
    if (payload.message?.source?.kind === 'user') cancelPendingContinue(payload.agent.id)
  })

  /** Track one active main agent and arm its watchdog when current config allows it. */
  function trackRunningAgent(agent: AgentLike): void {
    if (isSubagent(agent) || agent.status !== 'running') return
    runningAgents.set(agent.id, agent)
    const conf = cfg()
    if (conf.enabled && conf.mainAgent.idleWatchdog) armWatchdog(agent.id)
  }

  // A plugin mounted after a turn started must still observe the live agent.
  for (const agent of agents.list()) trackRunningAgent(agent)

  ctx.on('agent/created', (payload: { agent: AgentLike }) => {
    trackRunningAgent(payload.agent)
  })

  ctx.on('agent/status', (payload: { agent: AgentLike; status: 'idle' | 'running' }) => {
    const agent = payload.agent
    if (payload.status === 'idle') {
      runningAgents.delete(agent.id)
      disarmWatchdog(agent.id)
      return
    }
    // running：记录主智能体，供后续配置热更新时同步启停看门狗。
    if (isSubagent(agent)) return
    runningAgents.set(agent.id, agent)
    const conf = cfg()
    if (!conf.enabled || !conf.mainAgent.idleWatchdog) return
    armWatchdog(agent.id)
  })

  /** 流帧也是活动信号（覆盖长思考期没有 durable 事件的场景） */
  ctx.on('agent/assistant-stream', (payload: { agent: AgentLike; frame: unknown }) => {
    if (watchdogTimers.has(payload.agent.id)) armWatchdog(payload.agent.id)
  })

  /**
   * 布防/重置：为会话启动（或重启）无响应计时器。
   * 超时仍未有活动 → 主动 cancel（hook）→ turn 以 aborted{hook} 终局 → 自动继续层接手。
   */
  function armWatchdog(sessionId: string): void {
    disarmWatchdog(sessionId)
    const timeoutMs = cfg().mainAgent.idleTimeoutMs
    const timer = setTimeout(() => {
      watchdogTimers.delete(sessionId)
      const agent = agents.get(sessionId)
      if (!agent || agent.status !== 'running') return
      log.warn('会话 %s 超过 %d ms 无任何活动，主动取消当前请求以触发恢复', sessionId.slice(0, 8), timeoutMs)
      recordStat({ ts: Date.now(), kind: 'watchdog', sessionId, code: 'IDLE_TIMEOUT', source: 'supplemental', outcome: `idle>${timeoutMs}ms` })
      agent.cancel({ kind: 'hook', reason: 'auto-retry: idle watchdog' }, { keepInbox: true })
    }, timeoutMs)
    watchdogTimers.set(sessionId, { timer, timeoutMs })
  }

  /** 撤防 */
  function disarmWatchdog(sessionId: string): void {
    const watchdog = watchdogTimers.get(sessionId)
    if (watchdog) {
      clearTimeout(watchdog.timer)
      watchdogTimers.delete(sessionId)
    }
  }

  /* ---------- 配置热更新对账（volatile 变更不重启插件，这里同步状态） ---------- */
  ctx.on('loader/volatile-update', () => {
    const conf = cfg()
    // 每次读取最新配置，对当前运行中的主智能体同步布防状态与判定阈值。
    for (const [sessionId, agent] of runningAgents) {
      if (agent.status !== 'running') {
        runningAgents.delete(sessionId)
        disarmWatchdog(sessionId)
      } else if (conf.enabled && conf.mainAgent.idleWatchdog) {
        if (watchdogTimers.get(sessionId)?.timeoutMs !== conf.mainAgent.idleTimeoutMs) armWatchdog(sessionId)
      } else {
        disarmWatchdog(sessionId)
      }
    }
    // 自动继续被关闭或总开关关闭 → 撤销待发送任务
    if (!conf.enabled || !conf.mainAgent.autoContinue) {
      for (const sessionId of [...pendingContinues.keys()]) cancelPendingContinue(sessionId)
    }
  })

  /* ---------- agent 生命周期清理 ---------- */
  ctx.on('agent/disposed', (payload: { agent: AgentLike }) => {
    const sessionId = payload.agent?.id
    if (!sessionId) return
    runningAgents.delete(sessionId)
    disarmWatchdog(sessionId)
    const timer = pendingContinues.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      pendingContinues.delete(sessionId)
    }
    continueStreaks.delete(sessionId)
    sessionModels.delete(sessionId)
    clearRetryBucketsOfSession(sessionId)
  })

  /* ============================================================
   * 统计聚合与看板 API
   * ============================================================ */

  /** 聚合统计报告：按 (session, turn) 关联回合结果，计算平均重试次数成功等指标 */
  function buildStatsReport(days: number) {
    const events = filterEventsByDays(days)
    const retries = events.filter((e) => e.kind === 'retry')
    const continues = events.filter((e) => e.kind === 'continue')
    const watchdogs = events.filter((e) => e.kind === 'watchdog')
    const turnEnds = events.filter((e) => e.kind === 'turn-end')

    // 回合聚合：key = sessionId:turn → { retries: n, outcome }
    const turns = new Map<string, { retries: number; outcome?: string }>()
    for (const e of retries) {
      const key = `${e.sessionId}:${e.turn}`
      const entry = turns.get(key) ?? { retries: 0 }
      entry.retries += 1
      turns.set(key, entry)
    }
    for (const e of turnEnds) {
      const key = `${e.sessionId}:${e.turn}`
      const entry = turns.get(key) ?? { retries: 0 }
      entry.outcome = e.outcome
      turns.set(key, entry)
    }
    const completed = [...turns.values()].filter((t) => t.outcome === 'completed' && t.retries > 0)
    const failed = [...turns.values()].filter((t) => t.outcome === 'error')

    // 分布统计
    const tally = (items: Array<string | undefined>) => {
      const map = new Map<string, number>()
      for (const item of items) {
        if (!item) continue
        map.set(item, (map.get(item) ?? 0) + 1)
      }
      return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
    }
    const byDay = new Map<string, { retries: number; continues: number; failedTurns: number }>()
    const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10)
    for (const e of retries) {
      const day = dayOf(e.ts)
      const entry = byDay.get(day) ?? { retries: 0, continues: 0, failedTurns: 0 }
      entry.retries += 1
      byDay.set(day, entry)
    }
    for (const e of continues) {
      const day = dayOf(e.ts)
      const entry = byDay.get(day) ?? { retries: 0, continues: 0, failedTurns: 0 }
      entry.continues += 1
      byDay.set(day, entry)
    }
    for (const e of turnEnds) {
      if (e.outcome === 'error') {
        const day = dayOf(e.ts)
        const entry = byDay.get(day) ?? { retries: 0, continues: 0, failedTurns: 0 }
        entry.failedTurns += 1
        byDay.set(day, entry)
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      range: days,
      summary: {
        totalRetries: retries.length,
        builtInRetries: retries.filter((e) => e.source === 'built-in').length,
        supplementalRetries: retries.filter((e) => e.source === 'supplemental').length,
        autoContinues: continues.length,
        watchdogTriggers: watchdogs.length,
        successTurnsWithRetries: completed.length,
        failedTurns: failed.length,
        avgRetriesPerSuccessTurn: completed.length
          ? Math.round((completed.reduce((sum, t) => sum + t.retries, 0) / completed.length) * 10) / 10
          : 0,
      },
      byCode: tally(retries.map((e) => e.code)),
      bySource: tally(retries.map((e) => e.source)),
      byProvider: tally(retries.map((e) => (e.model ? `${e.provider ?? '?'}/${e.model}` : e.provider))),
      byDay: [...byDay.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, v]) => ({ date, ...v })),
      events: events.slice(-200).reverse(),
    }
  }

  /* ---------- 看板 HTTP API：动态注入 webServer（缺失时静默跳过，不影响其他能力） ---------- */
  ctx.inject(['webServer'], (scope: any) => {
    /** HTTP 响应工具：统一 JSON 输出 */
    const sendJson = (res: any, status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    // 统计查询端点
    const disposeStats = scope.webServer.register({
      kind: 'prefix',
      path: '/auto-retry',
      handler: async (req: { url?: string }, res: any) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (url.pathname === '/auto-retry/api/stats') {
            const days = Number(url.searchParams.get('days') ?? '7')
            sendJson(res, 200, buildStatsReport(Number.isFinite(days) ? days : 7))
            return
          }
          sendJson(res, 404, { error: 'not-found' })
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    ctx.effect(() => disposeStats, 'auto-retry: stats api route')

    // 实时通知 SSE 端点：client 用 EventSource 订阅，每条重试/继续/看门狗事件推一帧
    const disposeEvents = scope.webServer.register({
      kind: 'exact',
      path: '/auto-retry/api/events',
      handler: (req: unknown, res: any) => {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        // 首帧注释行：立即建立连接并防止代理缓冲
        res.write(': connected\n\n')
        sseClients.add(res)
        res.on?.('close', () => { sseClients.delete(res) })
      },
    })
    ctx.effect(() => disposeEvents, 'auto-retry: sse events route')
    log.info('看板 API 与实时通知 SSE 已注册：/auto-retry/api/stats、/auto-retry/api/events')
  })

  /* ---------- 卸载兜底：清掉所有定时器并落盘统计 ---------- */
  ctx.effect(() => {
    return async () => {
      disposed = true
      lifetime.abort(new Error('auto-retry plugin disposed'))
      for (const watchdog of watchdogTimers.values()) clearTimeout(watchdog.timer)
      watchdogTimers.clear()
      runningAgents.clear()
      for (const timer of pendingContinues.values()) clearTimeout(timer)
      pendingContinues.clear()
      retryBuckets.clear()
      continueStreaks.clear()
      if (statsFlushTimer) clearTimeout(statsFlushTimer)
      statsFlushTimer = undefined
      // 关闭全部 SSE 连接
      for (const res of [...sseClients]) {
        try { res.end() } catch { /* 尽力关闭 */ }
      }
      sseClients.clear()
      if (statsDirty) await flushStats()
      else await statsFlushPromise
    }
  }, 'auto-retry: dispose timers and state')

  log.info('自动重试插件已加载（补充重试 %d 条规则，自动继续 %s，看门狗 %s）',
    cfg().rules.filter((r) => r.enabled).length,
    cfg().mainAgent.autoContinue ? '开' : '关',
    cfg().mainAgent.idleWatchdog ? '开' : '关')
}
