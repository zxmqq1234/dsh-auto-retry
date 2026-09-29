import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom/client'
import { Checkbox, Input, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

/** 插件版本号：构建时由 scripts/build.mjs 从 package.json 的 version 注入。 */
declare const __DSHAR_VERSION__: string

/** 配置契约中每条失败规则的形状。 */
interface RetryRule {
  code: string
  enabled: boolean
  maxRetries: number
}

/** 与 DESIGN.md §3 对齐的 client 配置形状。 */
interface AutoRetryConfig {
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

/** ConfigForm 返回的最小只读快照。 */
interface ConfigSnapshot {
  status?: string
  value?: AutoRetryConfig
  base?: unknown
  user?: unknown
  revision?: number
  writable: boolean
  mode?: string
}

/** 内置设置镜像中 provider 重试策略的防御式形状。 */
interface ProviderStrategy {
  displayName?: unknown
  retryPolicy?: {
    mode?: unknown
    maxRetries?: unknown
    retryableCodes?: unknown
    backoff?: {
      initialDelayMs?: unknown
      maxDelayMs?: unknown
      jitterRatio?: unknown
    }
  }
  streamIdleTimeoutMs?: unknown
}

/** configForms.describe().getSnapshot() 的最小形状。 */
interface ConfigDescribeSnapshot {
  status?: unknown
  view?: { namespaces?: unknown }
  error?: unknown
}

/** 统计接口返回的事件与聚合数据形状。 */
interface StatsResponse {
  generatedAt?: unknown
  range?: unknown
  summary?: {
    totalRetries?: unknown
    builtInRetries?: unknown
    supplementalRetries?: unknown
    autoContinues?: unknown
    watchdogTriggers?: unknown
    successTurnsWithRetries?: unknown
    successTurns?: unknown
    failedTurns?: unknown
    avgRetriesPerSuccessTurn?: unknown
  }
  byCode?: Array<{ label?: unknown; code?: unknown; count?: unknown }>
  bySource?: Array<{ label?: unknown; source?: unknown; count?: unknown }>
  byProvider?: Array<{ label?: unknown; provider?: unknown; model?: unknown; count?: unknown }>
  byDay?: Array<{ date?: unknown; retries?: unknown; continues?: unknown; failedTurns?: unknown }>
  events?: Array<{
    ts?: unknown
    kind?: unknown
    sessionId?: unknown
    turn?: unknown
    provider?: unknown
    model?: unknown
    code?: unknown
    attempt?: unknown
    maxRetries?: unknown
    delayMs?: unknown
    source?: unknown
    outcome?: unknown
  }>
}

/** ConfigForm 的最小读写接口，避免引入运行时不存在的类型包。 */
interface ConfigForm {
  getSnapshot(): ConfigSnapshot
  subscribe(listener: () => void): () => void
  mutate(ops: ConfigMutation[], expectedRevision?: number): Promise<boolean>
}

/** 配置描述服务的最小只读接口。 */
interface ConfigDescribe {
  getSnapshot(): ConfigDescribeSnapshot
  subscribe(listener: () => void): () => void
}

/** 统计筛选范围。 */
type StatsRange = 0 | 1 | 7 | 30

/** 统计面板可消费的非空 provider 行。 */
interface ProviderStrategyRow {
  name: string
  retryText: string
  timeoutText: string
}

/** ConfigForm.mutate 接受的字段操作格式。 */
interface ConfigMutation {
  op: 'set'
  path: [string]
  value: unknown
}

/** 设置页注册信息的最小形状。 */
interface SettingsSectionOptions {
  name: string
  id: string
  order?: number
  locale?: string
  label?: () => string
  inject?: () => unknown
}

/** 右上角实时通知的一条待展示条目。 */
interface ToastItem {
  id: number
  title: string
  body: string
  tone: 'info' | 'warn'
}

/** client 插件运行时所需的最小上下文接口。 */
interface ClientContext {
  slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: SettingsSectionOptions, component: unknown): () => void
  }
  locale: {
    register(namespace: string, locale: string, messages: Record<string, unknown>): unknown
    bind(namespace: string): (key: string) => string
  }
  configForms: {
    get(entryId: string): ConfigForm
    describe(): ConfigDescribe
  }
  timer: {
    timeout(callback: () => void, ms: number): () => void
  }
  effect(effect: () => unknown, label?: string): unknown
}

/** 所有规则按契约固定显示顺序，默认值也来自 DESIGN.md §4。 */
const NS = 'auto-retry'

const RULE_DEFINITIONS = [
  { code: 'RATE_LIMIT', enabled: true, maxRetries: 2 },
  { code: 'SERVER', enabled: true, maxRetries: 2 },
  { code: 'TIMEOUT', enabled: true, maxRetries: 2 },
  { code: 'EMPTY_RESPONSE', enabled: true, maxRetries: 1 },
  { code: 'TRANSPORT', enabled: true, maxRetries: 3 },
  { code: 'UNKNOWN', enabled: true, maxRetries: 2 },
  { code: 'HTTP_4XX', enabled: false, maxRetries: 1 },
  { code: 'ABORTED', enabled: false, maxRetries: 1 },
] as const

/** 配置缺省值，供加载中、缺字段或旧配置防御式渲染。 */
const DEFAULT_CONFIG: AutoRetryConfig = {
  enabled: true,
  notify: true,
  rules: RULE_DEFINITIONS.map((rule) => ({ ...rule })),
  mainAgent: {
    requestRetry: true,
    autoContinue: true,
    continueDelayMs: 5000,
    maxConsecutive: 5,
    continueMessage: '继续',
    idleWatchdog: false,
    idleTimeoutMs: 180000,
    continueOnMaxTokens: false,
  },
  subAgent: {
    requestRetry: true,
  },
  backoff: {
    intervalMode: 'exponential',
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    fixedDelayMs: 5000,
  },
}

/** 中文文案，键名与英文文案保持一一对应。 */
const ZH: Record<string, unknown> = {
  nav: '自动重试',
  intro: '本插件是内置重试的追加层：内置 normal 模式默认重试 5 次后，本插件才开始追加。',
  layerRequest: '请求级补充重试：为内置重试未覆盖或已耗尽的失败追加重试。',
  layerContinue: '回合级自动继续：终局失败后发送继续消息，并用连续失败上限熔断。',
  layerWatchdog: '无响应看门狗：长时间没有流输出或事件时取消请求并自动继续。',
  enabled: '启用自动重试',
  enabledDesc: '开：插件按下方配置自动重试、自动继续并推送通知。关：插件完全停止工作（dsh 内置重试不受影响）。',
  notify: '实时通知',
  notifyDesc: '开：每次重试/继续/看门狗触发，界面右上角实时弹窗。关：静默执行，只在数据看板里留痕。',
  unavailable: '插件未启用或不可写',
  loading: '正在读取配置',
  triggerSection: '触发情况',
  mainAgent: '主智能体',
  subAgent: '子智能体',
  advanced: '高级',
  requestRetry: '请求级补充重试',
  requestRetryDesc: '开：下方勾选的情况在内置重试耗尽或不覆盖时，为主智能体的请求追加重试。关：主智能体只靠内置重试。',
  autoContinue: '回合级自动继续',
  autoContinueDesc: '开：回合彻底失败（重试穷尽、无可用模型等）后延迟 N 秒自动发"继续"开新回合。关：失败后保持停止，等你手动处理。你手动停止的回合永不自动继续。',
  continueDelay: '继续前延迟',
  continueDelayHint: '自动继续前等待的秒数。如填 5：回合失败后等 5 秒才自动发"继续"；这 5 秒内你若发消息，本次自动继续会跳过。',
  maxConsecutive: '连续失败上限',
  maxConsecutiveHint: '连续失败达到上限后停止自动继续（防止网络彻底断开时无限循环），回合成功后清零。如填 5：连败 5 次后暂停，成功一轮即重新计数。',
  continueMessage: '继续消息',
  continueMessageHint: '自动继续时以用户身份发给模型的消息文本。',
  idleWatchdog: '无响应看门狗',
  idleWatchdogDesc: '开：运行中超过判定时长无任何流输出/事件就主动取消并自动继续（治"流挂起卡死"）。关：请求挂起时只能手动停止。注意：长工具调用+模型长静默可能被误取消（会自动恢复，不丢上下文）。',
  idleTimeout: '无响应判定时长',
  idleTimeoutHint: '多少秒无任何活动判定为无响应。如填 120：整整 2 分钟没有任何流输出/事件才取消；内置流空闲超时默认 300 秒，填小于它的值可更快恢复。',
  watchdogHint: '回合运行期间若超过判定时长完全没有流输出/事件，主动取消当前请求并自动继续；注意与上游流空闲超时的关系。',
  subAgentHint: '子智能体是什么：主智能体通过 subagent 工具派生出来的临时 AI 助手，替主智能体执行子任务（如搜索、批处理），它有自己的会话和模型调用。',
  subAgentHint2: '失败时会发生什么：子智能体的请求失败会先走内置重试、再按上方规则追加；彻底失败后主智能体会收到一条错误结果并自行决定下一步（重派或换路），因此不提供"自动继续"。',
  subAgentHint3: '与主智能体的区别：子智能体通常一次性运行完即结束（one-shot），无法继续对话；重试次数与主智能体共用同一套"触发情况"配置。',
  subAgentDesc: '开：子智能体的请求失败也按上方勾选的情况追加重试。关：子智能体只靠内置重试。',
  backoffInitial: '初始退避',
  backoffInitialHint: '指数退避的起点（秒）。如填 2：第 1 次重试等 2 秒、第 2 次等 4 秒、第 3 次等 8 秒……直到上限。',
  backoffMax: '退避上限',
  backoffMaxHint: '指数退避的封顶（秒）。如填 60：无论指数翻到多大，单次等待不超过 60 秒。',
  fixedDelayHint: '每次重试固定等待的秒数。如填 30：每次重试前都等 30 秒；若上游返回 429 的 Retry-After，会优先用它。',
  backoffHint: '指数退避：间隔每次翻倍（初始×2ⁿ，封顶上限）；固定间隔：每次等固定秒数。两者都尊重 429 的 Retry-After 并加±10%抖动。',
  seconds: '秒',
  retries: '次',
  save: '保存',
  discard: '放弃',
  saved: '已保存',
  saveFailed: '保存失败，请重试。',
  'rules.RATE_LIMIT.label': '限流（429）',
  'rules.RATE_LIMIT.hint': '请求过于频繁/配额限流；内置默认已重试 5 次，此处为追加。',
  'rules.SERVER.label': '服务端错误（5xx）',
  'rules.SERVER.hint': '上游 5xx、过载；内置默认已重试，此处为追加。',
  'rules.TIMEOUT.label': '响应超时',
  'rules.TIMEOUT.hint': '连接建立但流空闲超时；内置默认已重试，此处为追加。',
  'rules.EMPTY_RESPONSE.label': '空响应',
  'rules.EMPTY_RESPONSE.hint': '模型正常结束但零内容；内置默认已重试，此处为追加。',
  'rules.TRANSPORT.label': '网络传输错误',
  'rules.TRANSPORT.hint': '连接中断、SSE 断开、DNS 等网络层故障；内置默认已重试，此处为追加。',
  'rules.UNKNOWN.label': '未知错误',
  'rules.UNKNOWN.hint': '无法归类的失败（网络差时常见）；内置默认不重试，此处为首次重试。',
  'rules.HTTP_4XX.label': '其他 HTTP 4xx',
  'rules.HTTP_4XX.hint': '404/408 等未单列的客户端错误（匹配 HTTP_ 前缀）。',
  'rules.ABORTED.label': '请求中断',
  'rules.ABORTED.hint': '含用户手动停止与看门狗取消；勾选后手动停止也会重试，慎选。',
  continueOnMaxTokens: '截断自动继续',
  continueOnMaxTokensHint: '输出因 max-tokens 被截断时自动发继续；连续截断同样计入熔断上限。',
  continueOnMaxTokensDesc: '开：输出因长度被截断时自动发继续接着写。关：截断即停（连续截断计入熔断上限，防止无限续写）。',
  footerVersion: '自动重试 v{version}',
  footerBy: 'by zxmqq1234',
  footerGithub: 'GitHub',
  toastRetryTitle: '已自动重试',
  toastContinueTitle: '回合失败，已自动继续',
  toastWatchdogTitle: '无响应看门狗',
  toastStreak: '连续第 {n} 次',
  intervalMode: '间隔模式',
  intervalExponential: '指数退避',
  intervalFixed: '固定间隔',
  fixedDelay: '固定间隔',
  explanationTitle: '为什么有时“没重试就直接停住”？',
  explanation1: '内置重试快且不可见：默认 5 次在几秒内跑完（间隔上限仅 10 秒），界面上基本无感知——展开下方“数据看板”可还原每次重试的真相。',
  explanation2: '零重试错误：无可用模型（NO_ADAPTER）、模型配置非法、请求准备失败等根本不走内置重试，直接失败——本插件的“回合级自动继续”会在失败后接住。',
  explanation3: '空响应当成功：模型返回空内容会被记为正常完成，无错误也无重试（目前无法自动区分）。',
  explanation4: '流挂起：回合内请求可能无限挂起（dsh 回合内没有超时保护）——开启“无响应看门狗”是唯一解药。',
  explanation5: '输出截断：max-tokens 结束不算失败、不重试——可开启“截断自动继续”。',
  builtInTitle: '内置重试策略',
  builtInDescription: '以下为各 provider 当前生效的内置重试策略（由内置 llm-retry 插件执行，本插件在其耗尽后追加）：',
  builtInProvider: 'provider',
  builtInRetry: '重试',
  builtInIdleTimeout: '流空闲超时',
  builtInNotFound: '未找到 provider 配置',
  builtInAlways: 'always 无限重试',
  builtInNormal: 'normal {count} 次',
  builtInDefault: '默认（normal 5 次）',
  builtInDefaultTimeout: '默认 300 秒',
  dashboardTitle: '数据看板',
  dashboardToday: '今天',
  dashboard7Days: '近7天',
  dashboard30Days: '近30天',
  dashboardAll: '全部',
  dashboardLoad: '加载统计',
  dashboardRefresh: '刷新',
  dashboardLoading: '加载中…',
  dashboardError: '统计加载失败：{error}',
  dashboardEmpty: '所选范围内暂无数据',
  dashboardTotalRetries: '总重试',
  dashboardBuiltInRetries: '内置重试',
  dashboardSupplementalRetries: '补充重试',
  dashboardContinues: '自动继续',
  dashboardWatchdog: '看门狗触发',
  dashboardSuccessTurns: '含重试的成功回合',
  dashboardFailedTurns: '失败回合',
  dashboardAverage: '平均重试次数成功',
  dashboardByCode: '按错误码',
  dashboardByProvider: '按 AI',
  dashboardByDay: '按日',
  dashboardDetails: '明细',
  dashboardDate: '日期',
  dashboardRetries: '重试',
  dashboardContinue: '继续',
  dashboardFailedTurn: '失败回合',
  dashboardTime: '时间',
  dashboardType: '类型',
  dashboardAi: 'AI',
  dashboardCode: '错误码',
  dashboardAttempt: '次数',
  dashboardSource: '来源',
  dashboardDelay: '延迟',
  dashboardRetry: '重试',
  dashboardWatchdogEvent: '看门狗',
  dashboardTurnEnd: '回合',
  dashboardBuiltIn: '内置',
  dashboardSupplemental: '补充',
  dashboardSeconds: '秒',
  tooltipEnabled: '总开关：关闭后本插件完全停止工作（dsh 内置重试不受影响）。',
  'tooltip.RATE_LIMIT': 'API 返回 429 限流：短时间请求过多、中转站或官方配额限流。内置默认已重试 5 次（间隔 0.5~10 秒），耗尽后本插件按此处次数继续追加。',
  'tooltip.SERVER': '上游 5xx：DeepSeek 或中转服务过载、宕机、网关错误（502/503/504）。内置默认已重试 5 次，此处为追加。',
  'tooltip.TIMEOUT': '响应超时：连接建立但流长时间无数据（流空闲超时，内置默认 5 分钟）。内置默认已重试 5 次，此处为追加。嫌 5 分钟太久可在 provider 配置里调低 streamIdleTimeoutMs。',
  'tooltip.EMPTY_RESPONSE': '空响应：请求正常结束但模型零内容输出。内置默认已重试 5 次，此处为追加。',
  'tooltip.TRANSPORT': '网络传输错误：连接中断、SSE 断开、DNS 失败等网络层故障——网络差时最常见。内置默认已重试 5 次，此处为追加。',
  'tooltip.UNKNOWN': '未知错误：无法归类的失败（网络差时的奇葩错误多归此类）。注意：内置默认不重试此类，此处是首次重试机会。',
  'tooltip.HTTP_4XX': '其他 HTTP 4xx：404/408 等未单列的客户端错误。内置不重试，此处为首次重试机会。',
  'tooltip.ABORTED': '请求中断：包括手动点停止和看门狗取消。勾选后手动停止也会被重试，一般不建议勾选。',
  tooltipRequestRetry: '勾选的错误码在内置重试耗尽或不覆盖时，为主智能体的请求追加重试。',
  tooltipAutoContinue: '回合彻底失败（重试穷尽、无可用模型、请求准备失败等）后，等待 N 秒自动发送继续消息开启新回合。你手动停止的回合永不自动继续。',
  tooltipContinueDelay: '自动继续前等待的秒数——留时间给你手动介入；延迟期间你若发消息则自动跳过本次继续。',
  tooltipMaxConsecutive: '同一会话连续失败达到此次数后停止自动继续（防止网络彻底断开时无限循环）。回合成功后清零。',
  tooltipContinueMessage: '自动继续时以用户身份发给模型的消息文本。',
  tooltipIdleWatchdog: '回合运行中若超过判定时长完全没有流输出或事件，主动取消当前请求并走自动继续。可修复“流挂起永远卡住”（dsh 回合内无超时保护），但长工具调用期间模型长静默可能被误取消（会自动恢复，不丢上下文）。',
  tooltipIdleTimeout: '多少秒无任何活动判定为无响应。内置流空闲超时默认 5 分钟，想更快恢复可调小（如 120 秒）。',
  tooltipContinueOnMaxTokens: '输出因 max-tokens 被截断时自动发继续。连续截断同样计入熔断上限，防止无限续写。',
  tooltipSubAgentRetry: '子智能体（subagent 工具派生）的请求失败也按规则追加重试。子智能体失败后主智能体会收到错误结果并自行处理，因此不提供自动继续。',
}

/** 英文文案，保证所有 UI key 在双语字典中都有定义。 */
const EN: Record<string, unknown> = {
  nav: 'Auto retry',
  intro: 'This plugin is an additive layer on top of built-in retries: it starts after normal mode has used its default 5 retries.',
  layerRequest: 'Request-level supplemental retry: adds attempts for failures not covered by, or exhausted by, built-in retry.',
  layerContinue: 'Turn-level auto-continue: sends a continuation message after a terminal failure with a consecutive-failure fuse.',
  layerWatchdog: 'No-response watchdog: cancels a request with no stream output or event for too long, then auto-continues.',
  enabled: 'Enable auto retry',
  unavailable: 'Plugin is disabled or read-only',
  loading: 'Loading configuration',
  triggerSection: 'Trigger cases',
  mainAgent: 'Main agent',
  subAgent: 'Sub-agent',
  advanced: 'Advanced',
  requestRetry: 'Supplemental request retry',
  autoContinue: 'Turn-level auto-continue',
  continueDelay: 'Delay before continuing',
  continueDelayHint: 'Time to wait before an automatic continuation.',
  maxConsecutive: 'Consecutive failure limit',
  maxConsecutiveHint: 'Stop automatic continuation after this many consecutive failures; reset after a successful turn.',
  continueMessage: 'Continuation message',
  continueMessageHint: 'Sent to the model as a user message.',
  idleWatchdog: 'No-response watchdog',
  idleTimeout: 'No-response threshold',
  watchdogHint: 'If a running turn has no stream output or event for longer than this threshold, cancel the request and auto-continue; consider the upstream stream idle timeout.',
  subAgentHint: 'The main agent takes over after a sub-agent failure; no automatic continuation is performed.',
  backoffInitial: 'Initial backoff',
  backoffMax: 'Backoff maximum',
  backoffHint: 'Exponential backoff doubles each interval (initial ×2ⁿ, capped); fixed interval waits the same amount each time. Both respect 429 Retry-After and add ±10% jitter.',
  seconds: 'seconds',
  retries: 'retries',
  save: 'Save',
  discard: 'Discard',
  saved: 'Saved',
  saveFailed: 'Save failed. Please try again.',
  'rules.RATE_LIMIT.label': 'Rate limit (429)',
  'rules.RATE_LIMIT.hint': 'Requests too frequent or quota limited; built-in retry already tried 5 times, so this is additive.',
  'rules.SERVER.label': 'Server error (5xx)',
  'rules.SERVER.hint': 'Upstream 5xx or overload; built-in retry already tried, so this is additive.',
  'rules.TIMEOUT.label': 'Response timeout',
  'rules.TIMEOUT.hint': 'Connection established but the stream was idle; built-in retry already tried, so this is additive.',
  'rules.EMPTY_RESPONSE.label': 'Empty response',
  'rules.EMPTY_RESPONSE.hint': 'The model ended normally without content; built-in retry already tried, so this is additive.',
  'rules.TRANSPORT.label': 'Transport error',
  'rules.TRANSPORT.hint': 'Connection reset, SSE disconnect, DNS, or another network-layer failure; built-in retry already tried, so this is additive.',
  'rules.UNKNOWN.label': 'Unknown error',
  'rules.UNKNOWN.hint': 'An uncategorized failure, common on unstable networks; built-in retry does not retry this by default, so this is the first retry.',
  'rules.HTTP_4XX.label': 'Other HTTP 4xx',
  'rules.HTTP_4XX.hint': 'Client errors such as 404/408 not listed separately; matches the HTTP_ prefix.',
  'rules.ABORTED.label': 'Request aborted',
  'rules.ABORTED.hint': 'Includes manual stops and watchdog cancellation; selecting this also retries manual stops, so use with care.',
  continueOnMaxTokens: 'Continue after truncation',
  continueOnMaxTokensHint: 'Automatically continue when output is truncated by max-tokens; consecutive truncations count toward the fuse limit.',
  intervalMode: 'Interval mode',
  intervalExponential: 'Exponential backoff',
  intervalFixed: 'Fixed interval',
  fixedDelay: 'Fixed interval',
  explanationTitle: 'Why does it sometimes stop “without retrying”?',
  explanation1: 'Built-in retries are fast and invisible: the default 5 attempts finish within seconds (only 10 seconds maximum delay), so the UI barely changes. Expand “Dashboard” below to reconstruct every retry.',
  explanation2: 'Zero-retry errors: no available model (NO_ADAPTER), invalid model configuration, and request preparation failures bypass built-in retry and fail immediately. This plugin’s turn-level auto-continue catches them afterward.',
  explanation3: 'Empty responses count as success: a model can finish with no content and no error or retry (there is currently no automatic way to distinguish this).',
  explanation4: 'A hung stream: a turn request can hang indefinitely because dsh has no turn-level timeout protection. Enabling the no-response watchdog is the only remedy.',
  explanation5: 'Output truncation: max-tokens is a normal ending, not a failure, so it is not retried. Enable “Continue after truncation”.',
  builtInTitle: 'Built-in retry strategy',
  builtInDescription: 'The currently effective built-in retry strategy for each provider (executed by the built-in llm-retry plugin; this plugin adds retries after it is exhausted):',
  builtInProvider: 'Provider',
  builtInRetry: 'Retries',
  builtInIdleTimeout: 'Stream idle timeout',
  builtInNotFound: 'No provider configuration found',
  builtInAlways: 'always (unlimited)',
  builtInNormal: 'normal ({count} retries)',
  builtInDefault: 'Default (normal, 5 retries)',
  builtInDefaultTimeout: 'Default (300 seconds)',
  dashboardTitle: 'Dashboard',
  dashboardToday: 'Today',
  dashboard7Days: 'Last 7 days',
  dashboard30Days: 'Last 30 days',
  dashboardAll: 'All',
  dashboardLoad: 'Load statistics',
  dashboardRefresh: 'Refresh',
  dashboardLoading: 'Loading…',
  dashboardError: 'Failed to load statistics: {error}',
  dashboardEmpty: 'No data in the selected range',
  dashboardTotalRetries: 'Total retries',
  dashboardBuiltInRetries: 'Built-in retries',
  dashboardSupplementalRetries: 'Supplemental retries',
  dashboardContinues: 'Auto-continues',
  dashboardWatchdog: 'Watchdog triggers',
  dashboardSuccessTurns: 'Successful turns with retries',
  dashboardFailedTurns: 'Failed turns',
  dashboardAverage: 'Average retries per successful turn',
  dashboardByCode: 'By error code',
  dashboardByProvider: 'By AI',
  dashboardByDay: 'By day',
  dashboardDetails: 'Details',
  dashboardDate: 'Date',
  dashboardRetries: 'Retries',
  dashboardContinue: 'Continues',
  dashboardFailedTurn: 'Failed turns',
  dashboardTime: 'Time',
  dashboardType: 'Type',
  dashboardAi: 'AI',
  dashboardCode: 'Error code',
  dashboardAttempt: 'Attempts',
  dashboardSource: 'Source',
  dashboardDelay: 'Delay',
  dashboardRetry: 'Retry',
  dashboardWatchdogEvent: 'Watchdog',
  dashboardTurnEnd: 'Turn',
  dashboardBuiltIn: 'Built-in',
  dashboardSupplemental: 'Supplemental',
  dashboardSeconds: 'seconds',
  tooltipEnabled: 'Global switch: when off, this plugin stops completely (dsh built-in retries are unaffected).',
  'tooltip.RATE_LIMIT': 'API returned 429 rate limit: too many requests in a short time, or relay/provider quota limiting. Built-in retry normally tries 5 times (0.5–10 second delays); this plugin adds the configured attempts afterward.',
  'tooltip.SERVER': 'Upstream 5xx: DeepSeek or relay overload, outage, or gateway errors (502/503/504). Built-in retry normally tries 5 times; this is additive.',
  'tooltip.TIMEOUT': 'Response timeout: the connection exists but the stream has no data for too long (stream idle timeout, 5 minutes by default). Built-in retry normally tries 5 times; this is additive. Lower streamIdleTimeoutMs in provider settings if 5 minutes is too long.',
  'tooltip.EMPTY_RESPONSE': 'Empty response: the request ended normally but the model produced no content. Built-in retry normally tries 5 times; this is additive.',
  'tooltip.TRANSPORT': 'Network transport error: connection interruption, SSE disconnect, DNS failure, or another network-layer fault—most common on poor networks. Built-in retry normally tries 5 times; this is additive.',
  'tooltip.UNKNOWN': 'Unknown error: an uncategorized failure (unstable networks often produce unusual errors here). Built-in retry does not retry this by default; this is the first retry opportunity.',
  'tooltip.HTTP_4XX': 'Other HTTP 4xx: client errors such as 404/408 not listed separately. Built-in retry does not retry these; this is the first retry opportunity.',
  'tooltip.ABORTED': 'Request aborted: includes manual stop and watchdog cancellation. Selecting this retries manual stops too, which is generally not recommended.',
  tooltipRequestRetry: 'Adds request retries for the selected error codes after built-in retry is exhausted or does not cover them.',
  tooltipAutoContinue: 'After a turn finally fails (retries exhausted, no model, request preparation failure, etc.), wait N seconds and send a continuation message to start a new turn. Manually stopped turns never auto-continue.',
  tooltipContinueDelay: 'Seconds to wait before auto-continuing—leaves time for manual intervention. If you send a message during the delay, this continuation is skipped.',
  tooltipMaxConsecutive: 'Stop auto-continuing after this many consecutive failures in one session (prevents an endless loop when the network is down). Reset after a successful turn.',
  tooltipContinueMessage: 'The user message text sent to the model for an automatic continuation.',
  tooltipIdleWatchdog: 'If a running turn has no stream output or event for longer than the threshold, cancel the request and use auto-continue. It fixes a permanently hung stream (dsh has no turn-level timeout), but long silent tool calls may be cancelled mistakenly (context is recovered automatically).',
  tooltipIdleTimeout: 'Seconds without any activity before treating the turn as unresponsive. Built-in stream idle timeout is 5 minutes; lower this (for example, 120 seconds) to recover sooner.',
  tooltipContinueOnMaxTokens: 'Automatically continue when output is truncated by max-tokens. Consecutive truncations count toward the fuse limit to prevent endless writing.',
  tooltipSubAgentRetry: 'Request failures from sub-agents (derived by subagent tools) also use the supplemental retry rules. The main agent receives the failure result and handles it, so auto-continue is not provided.',
  enabledDesc: 'On: the plugin retries, continues and notifies per the configuration below. Off: the plugin is fully inactive (built-in dsh retry is unaffected).',
  notify: 'Live notifications',
  notifyDesc: 'On: every retry/continue/watchdog event pops up in the top-right corner. Off: silent execution, only recorded in the dashboard.',
  requestRetryDesc: 'On: selected failures get supplemental retries for the main agent after built-in retry is exhausted or not applicable. Off: main agent relies on built-in retry only.',
  autoContinueDesc: 'On: after a turn fails for good (retries exhausted, no adapter, ...), wait N seconds and auto-send "continue". Off: the session stays stopped until you act. Manually stopped turns never auto-continue.',
  continueDelayHint: 'Seconds to wait before an automatic continuation. E.g. 5: the continuation fires 5s after a failed turn; sending a message during that window skips it.',
  maxConsecutiveHint: 'Stop auto-continuing after this many consecutive failures (prevents infinite loops when the network is fully down); a successful turn resets the count. E.g. 5: pause after 5 straight failures.',
  continueMessageHint: 'Sent to the model as the user message when auto-continuing.',
  idleWatchdogDesc: 'On: if a running turn has no stream output or event for the threshold, cancel it and auto-continue (fixes hung requests). Off: a hung request can only be stopped manually. Note: long tool calls with a silent model may be cancelled (it recovers automatically without losing context).',
  idleTimeoutHint: 'Seconds of zero activity before declaring no-response. E.g. 120: cancel only after 2 full minutes of silence; the built-in stream idle timeout defaults to 300s — lower values recover faster.',
  subAgentHint: 'What a sub-agent is: a temporary AI assistant derived by the main agent via the subagent tool for subtasks (search, batch work, ...). It has its own session and model calls.',
  subAgentHint2: 'On failure: the sub-agent request goes through built-in retry first, then the rules above. If it fails for good, the main agent receives an error result and decides what to do (re-dispatch or reroute), so no auto-continue is needed.',
  subAgentHint3: 'Differences from the main agent: sub-agents usually run once and finish (one-shot) and cannot be continued; retry counts share the same "trigger cases" configuration as the main agent.',
  subAgentDesc: 'On: sub-agent request failures also get supplemental retries per the selected cases. Off: sub-agents rely on built-in retry only.',
  continueOnMaxTokensDesc: 'On: when output is truncated by length, auto-send "continue" to keep writing. Off: stop at truncation (consecutive truncations count toward the fuse).',
  backoffInitialHint: 'Starting point of exponential backoff (seconds). E.g. 2: retry 1 waits 2s, retry 2 waits 4s, retry 3 waits 8s... up to the cap.',
  backoffMaxHint: 'Cap of exponential backoff (seconds). E.g. 60: no single wait exceeds 60 seconds no matter how the exponent grows.',
  fixedDelayHint: 'Fixed seconds to wait before each retry. E.g. 30: every retry waits 30s first; a 429 Retry-After from upstream takes precedence.',
  footerVersion: 'Auto retry v{version}',
  footerBy: 'by zxmqq1234',
  footerGithub: 'GitHub',
  toastRetryTitle: 'Retried automatically',
  toastContinueTitle: 'Turn failed, continued automatically',
  toastWatchdogTitle: 'No-response watchdog',
  toastStreak: 'streak #{n}',
}

/** 设置板块使用的局部 CSS，所有颜色通过语义变量或继承色表达。 */
const STYLES = `
.dshar-root { display: flex; flex-direction: column; gap: 14px; color: inherit; }
.dshar-intro { display: flex; flex-direction: column; gap: 6px; line-height: 1.5; }
.dshar-intro-title { font-size: 14px; font-weight: 600; }
.dshar-intro-copy, .dshar-hint, .dshar-status { font-size: 12px; opacity: .7; line-height: 1.45; }
.dshar-layer-list { display: flex; flex-direction: column; gap: 3px; margin: 2px 0 0; padding-left: 16px; }
.dshar-card { display: flex; flex-direction: column; padding: 12px 14px; border: 1px solid var(--dsw-border-subtle, currentColor); border-radius: 8px; }
.dshar-card-title { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
/* 统一开关行：左标题+说明，右开关；项与项之间细分隔线 */
.dshar-row-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 10px 0; }
.dshar-row-item + .dshar-row-item,
.dshar-row-item + .dshar-field,
.dshar-field + .dshar-row-item,
.dshar-field + .dshar-field,
.dshar-row-item + .dshar-note { border-top: 1px solid var(--dsw-border-subtle, rgba(128,128,128,.22)); }
.dshar-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dshar-row-label { font-size: 13px; font-weight: 500; }
.dshar-row-desc { font-size: 12px; opacity: .65; line-height: 1.45; }
/* 开关的从属子字段：缩进并加从属边线 */
.dshar-subfield { margin-left: 14px; padding-left: 12px; border-left: 2px solid var(--dsw-border-subtle, rgba(128,128,128,.22)); display: flex; flex-direction: column; padding-top: 8px; padding-bottom: 8px; gap: 2px; }
.dshar-subfield > .dshar-field { padding: 6px 0; }
.dshar-subfield > .dshar-field + .dshar-field { border-top: 1px solid var(--dsw-border-subtle, rgba(128,128,128,.15)); }
.dshar-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 34px; }
.dshar-rule-row { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(220px, 2fr) auto; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--dsw-border-subtle, currentColor); }
.dshar-rule-row:first-of-type { border-top: 0; padding-top: 0; }
.dshar-rule-name { min-width: 0; }
.dshar-rule-hint { min-width: 0; }
.dshar-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dshar-field-label { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dshar-field-label > span:first-child { font-size: 13px; font-weight: 500; }
.dshar-field-label .dshar-hint { font-size: 11.5px; }
.dshar-number { width: 92px; flex: 0 0 92px; }
.dshar-text { width: min(100%, 280px); flex: 0 1 280px; }
.dshar-unit { display: flex; align-items: center; gap: 6px; }
.dshar-note { padding-top: 8px; font-size: 12px; opacity: .7; line-height: 1.45; }
.dshar-subblock { margin: 0; padding: 8px 0 0; display: flex; flex-direction: column; gap: 6px; }
.dshar-actions { display: flex; align-items: center; gap: 8px; min-height: 34px; }
.dshar-button { border: 1px solid currentColor; border-radius: 6px; padding: 7px 14px; background: transparent; color: inherit; cursor: pointer; }
.dshar-button:disabled { cursor: default; opacity: .45; }
.dshar-status { margin-left: 4px; }
.dshar-unavailable { padding: 8px 10px; border: 1px solid var(--dsw-border-subtle, currentColor); border-radius: 6px; opacity: .75; }
.dshar-details { display: flex; flex-direction: column; gap: 12px; }
.dshar-summary { cursor: pointer; font-size: 14px; font-weight: 600; }
.dshar-explanation { margin: 0; padding-left: 20px; line-height: 1.55; }
.dshar-provider-list { display: flex; flex-direction: column; gap: 8px; }
.dshar-provider-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(160px, 1fr) minmax(140px, 1fr); gap: 10px; padding: 7px 0; border-top: 1px solid var(--dsw-border-subtle, currentColor); font-size: 12px; }
.dshar-provider-row:first-child { border-top: 0; }
.dshar-muted { opacity: .7; }
.dshar-segmented { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
.dshar-segmented-control { flex: 0 0 auto; }
.dshar-footer { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 4px 0 0; font-size: 12px; opacity: .62; }
.dshar-footer a { color: inherit; text-decoration: underline; }
.dshar-footer a:hover { opacity: .8; }
/* 右上角实时通知栈：portal 到 body，z-index 压过 modal（照抄内置 Toast 的做法） */
.dshar-toast-stack { position: fixed; top: 16px; right: 16px; z-index: 1100; display: flex; flex-direction: column; gap: 8px; pointer-events: none; max-width: 340px; }
.dshar-toast { pointer-events: auto; background: var(--dsw-alias-toast-bg, rgba(32,32,34,.96)); color: var(--dsw-alias-toast-fg, #f5f5f5); border-radius: 10px; padding: 10px 14px; box-shadow: 0 6px 20px rgba(0,0,0,.28); font-size: 12px; line-height: 1.4; animation: dshar-toast-in .18s ease-out; }
.dshar-toast-title { display: block; font-size: 12.5px; font-weight: 600; }
.dshar-toast-body { display: block; margin-top: 2px; opacity: .85; }
.dshar-toast-warn { border-left: 3px solid var(--dsw-alias-warning-fg, #e6a23c); }
@keyframes dshar-toast-in { from { transform: translateX(14px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
.dshar-dashboard-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dshar-dashboard-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshar-dashboard-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.dshar-dashboard-stat { padding: 9px; border: 1px solid var(--dsw-border-subtle, currentColor); border-radius: 6px; }
.dshar-dashboard-stat-value { display: block; font-size: 16px; font-weight: 600; }
.dshar-dashboard-stat-label { display: block; margin-top: 3px; font-size: 12px; opacity: .72; line-height: 1.3; }
.dshar-dashboard-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dshar-dashboard-subcard { min-width: 0; }
.dshar-dashboard-subtitle { margin: 0 0 7px; font-size: 13px; font-weight: 600; }
.dshar-dashboard-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 12px; }
.dshar-dashboard-list li { display: flex; justify-content: space-between; gap: 8px; }
.dshar-dashboard-table-wrap { overflow-x: auto; }
.dshar-dashboard-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dshar-dashboard-table th, .dshar-dashboard-table td { padding: 6px 7px; border-top: 1px solid var(--dsw-border-subtle, currentColor); text-align: left; white-space: nowrap; }
.dshar-dashboard-table th { font-weight: 600; }
.dshar-dashboard-error { color: inherit; opacity: .85; }
@media (max-width: 720px) {
  .dshar-rule-row { grid-template-columns: 1fr auto; }
  .dshar-rule-hint { grid-column: 1 / -1; }
  .dshar-provider-row { grid-template-columns: 1fr; gap: 3px; }
  .dshar-dashboard-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dshar-dashboard-columns { grid-template-columns: 1fr; }
}
`

/** 在数字控件写入前将值限制在契约范围内。 */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, numeric))
}

/** 将数字读取为整数，兼容输入框清空或非法值。 */
function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback))
}

/** 深拷贝配置，保证草稿编辑不会修改 ConfigForm 的快照引用。 */
function cloneConfig(config: AutoRetryConfig): AutoRetryConfig {
  return JSON.parse(JSON.stringify(config)) as AutoRetryConfig
}

/** 防御式读取配置，并按契约规则顺序补全缺失字段。 */
function normalizeConfig(value: AutoRetryConfig | undefined): AutoRetryConfig {
  const source = value ?? DEFAULT_CONFIG
  const sourceRules = Array.isArray(source.rules) ? source.rules : []
  const rules = RULE_DEFINITIONS.map((definition) => {
    const found = sourceRules.find((rule) => rule?.code === definition.code)
    return {
      code: definition.code,
      enabled: typeof found?.enabled === 'boolean' ? found.enabled : definition.enabled,
      maxRetries: clampInteger(found?.maxRetries, 0, 20, definition.maxRetries),
    }
  })
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_CONFIG.enabled,
    rules,
    mainAgent: {
      requestRetry: typeof source.mainAgent?.requestRetry === 'boolean' ? source.mainAgent.requestRetry : DEFAULT_CONFIG.mainAgent.requestRetry,
      autoContinue: typeof source.mainAgent?.autoContinue === 'boolean' ? source.mainAgent.autoContinue : DEFAULT_CONFIG.mainAgent.autoContinue,
      continueDelayMs: clampInteger(source.mainAgent?.continueDelayMs, 0, 600000, DEFAULT_CONFIG.mainAgent.continueDelayMs),
      maxConsecutive: clampInteger(source.mainAgent?.maxConsecutive, 1, 50, DEFAULT_CONFIG.mainAgent.maxConsecutive),
      continueMessage: typeof source.mainAgent?.continueMessage === 'string' ? source.mainAgent.continueMessage : DEFAULT_CONFIG.mainAgent.continueMessage,
      idleWatchdog: typeof source.mainAgent?.idleWatchdog === 'boolean' ? source.mainAgent.idleWatchdog : DEFAULT_CONFIG.mainAgent.idleWatchdog,
      idleTimeoutMs: clampInteger(source.mainAgent?.idleTimeoutMs, 30000, 600000, DEFAULT_CONFIG.mainAgent.idleTimeoutMs),
      continueOnMaxTokens: typeof source.mainAgent?.continueOnMaxTokens === 'boolean' ? source.mainAgent.continueOnMaxTokens : DEFAULT_CONFIG.mainAgent.continueOnMaxTokens,
    },
    subAgent: {
      requestRetry: typeof source.subAgent?.requestRetry === 'boolean' ? source.subAgent.requestRetry : DEFAULT_CONFIG.subAgent.requestRetry,
    },
    backoff: {
      intervalMode: source.backoff?.intervalMode === 'fixed' ? 'fixed' : 'exponential',
      initialDelayMs: clampInteger(source.backoff?.initialDelayMs, 100, 60000, DEFAULT_CONFIG.backoff.initialDelayMs),
      maxDelayMs: clampInteger(source.backoff?.maxDelayMs, 1000, 300000, DEFAULT_CONFIG.backoff.maxDelayMs),
      fixedDelayMs: clampInteger(source.backoff?.fixedDelayMs, 100, 600000, DEFAULT_CONFIG.backoff.fixedDelayMs),
    },
  }
}

/** 比较两个纯配置对象，用于决定保存与放弃按钮是否可用。 */
function configsEqual(left: AutoRetryConfig, right: AutoRetryConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** 将毫秒转换为适合设置页编辑的秒数。 */
function millisecondsToSeconds(milliseconds: number): number {
  return milliseconds / 1000
}

/** 将秒转换为整数毫秒，避免浮点数写入 schema。 */
function secondsToMilliseconds(seconds: number, min: number, max: number, fallbackMs: number): number {
  const fallbackSeconds = millisecondsToSeconds(fallbackMs)
  return Math.round(clampNumber(seconds, min, max, fallbackSeconds) * 1000)
}

/** 渲染一个带标题、说明和控件的设置字段。 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="dshar-field">
      <div className="dshar-field-label">
        <span>{label}</span>
        {hint ? <span className="dshar-hint">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

/**
 * 统一开关行：左侧标题 + "开了/关了会怎样"说明（不换行），右侧开关。
 * Switch 内置 label 仅作为 aria-label（视觉不可见），可见文字全部由本组件渲染。
 */
function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string
  desc?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="dshar-row-item">
      <div className="dshar-row-text">
        <span className="dshar-row-label">{label}</span>
        {desc ? <span className="dshar-row-desc">{desc}</span> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} title={desc} disabled={disabled} />
    </div>
  )
}

/** 将未知值转换成安全的非负整数，用于只读策略和统计展示。 */
function displayInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}

/** 将未知值转换成有限数字，用于统计展示。 */
function displayNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 将模板文案中的占位符替换为实际值。 */
function formatMessage(message: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), message)
}

/** 从 configForms 描述快照中安全提取两个 LLM namespace 的 provider 策略。 */
function readProviderStrategies(describe: ConfigDescribe, t: (key: string) => string): ProviderStrategyRow[] {
  try {
    const snapshot = describe.getSnapshot()
    const namespaces = Array.isArray(snapshot?.view?.namespaces) ? snapshot.view.namespaces : []
    const rows: ProviderStrategyRow[] = []
    for (const namespace of namespaces) {
      if (!namespace || typeof namespace !== 'object') continue
      const item = namespace as { ns?: unknown; value?: unknown }
      if (item.ns !== 'llm-pi-ai' && item.ns !== 'llm-deepseek') continue
      if (!item.value || typeof item.value !== 'object') continue
      const providers = (item.value as { providers?: unknown }).providers
      if (!providers || typeof providers !== 'object' || Array.isArray(providers)) continue
      for (const [key, rawProvider] of Object.entries(providers as Record<string, unknown>)) {
        if (!rawProvider || typeof rawProvider !== 'object') continue
        const provider = rawProvider as ProviderStrategy
        const policy = provider.retryPolicy
        const retryText = policy
          ? policy.mode === 'always'
            ? t('builtInAlways')
            : formatMessage(t('builtInNormal'), { count: displayInteger(policy.maxRetries, 5) })
          : t('builtInDefault')
        const timeout = displayInteger(provider.streamIdleTimeoutMs, 0)
        rows.push({
          name: typeof provider.displayName === 'string' && provider.displayName ? provider.displayName : key,
          retryText,
          timeoutText: timeout > 0 ? `${timeout / 1000}${t('seconds')}` : t('builtInDefaultTimeout'),
        })
      }
    }
    return rows
  } catch {
    return []
  }
}

/** 将毫秒时间戳格式化为本地 HH:mm:ss，非法值安全回退。 */
function formatEventTime(value: unknown): string {
  const timestamp = displayNumber(value, 0)
  if (timestamp <= 0) return '—'
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return '—'
  }
}

/** 将统计事件类型转换成当前语言可读文字。 */
function eventKindLabel(kind: unknown, t: (key: string) => string): string {
  if (kind === 'retry') return t('dashboardRetry')
  if (kind === 'continue') return t('dashboardContinue')
  if (kind === 'watchdog') return t('dashboardWatchdogEvent')
  if (kind === 'turn-end') return t('dashboardTurnEnd')
  return typeof kind === 'string' && kind ? kind : '—'
}

/** 渲染触发情况清单中的单条规则。 */
function RuleRow({
  rule,
  t,
  disabled,
  onChange,
}: {
  rule: RetryRule
  t: (key: string) => string
  disabled: boolean
  onChange: (patch: Partial<RetryRule>) => void
}) {
  const tooltip = t(`tooltip.${rule.code}`)
  return (
    <div className="dshar-rule-row" title={tooltip}>
      <Checkbox
        checked={rule.enabled}
        onChange={(enabled) => onChange({ enabled })}
        label={t(`rules.${rule.code}.label`)}
        title={tooltip}
        disabled={disabled}
      />
      <span className="dshar-hint dshar-rule-hint">{t(`rules.${rule.code}.hint`)}</span>
      <Input
        className="dshar-number"
        type="number"
        min={0}
        max={20}
        step={1}
        value={rule.maxRetries}
        title={tooltip}
        aria-label={`${t(`rules.${rule.code}.label`)} ${t('retries')}`}
        disabled={disabled || !rule.enabled}
        onChange={(event) => onChange({ maxRetries: clampInteger(event.currentTarget.valueAsNumber, 0, 20, rule.maxRetries) })}
      />
    </div>
  )
}

/** 渲染“为什么没重试就停住”的折叠说明卡。 */
function ExplanationCard({ t }: { t: (key: string) => string }) {
  return (
    <details className="dshar-card dshar-details">
      <summary className="dshar-summary">{t('explanationTitle')}</summary>
      <ol className="dshar-explanation dshar-hint">
        <li>{t('explanation1')}</li>
        <li>{t('explanation2')}</li>
        <li>{t('explanation3')}</li>
        <li>{t('explanation4')}</li>
        <li>{t('explanation5')}</li>
      </ol>
    </details>
  )
}

/** 渲染只读的内置 provider 重试策略信息卡；任何描述异常都安全降级。 */
function BuiltInStrategyCard({ t, describe }: { t: (key: string) => string; describe: ConfigDescribe }) {
  const [revision, setRevision] = useState(0)

  // 配置描述通常异步到达；订阅 mirror 后让卡片在 provider 配置到达时刷新。
  useEffect(() => describe.subscribe(() => setRevision((current) => current + 1)), [describe])

  const rows = readProviderStrategies(describe, t)
  void revision
  return (
    <div className="dshar-card">
      <h3 className="dshar-card-title">{t('builtInTitle')}</h3>
      <div className="dshar-hint">{t('builtInDescription')}</div>
      {rows.length > 0 ? (
        <div className="dshar-provider-list">
          <div className="dshar-provider-row dshar-muted">
            <span>{t('builtInProvider')}</span>
            <span>{t('builtInRetry')}</span>
            <span>{t('builtInIdleTimeout')}</span>
          </div>
          {rows.map((row, index) => (
            <div className="dshar-provider-row" key={`${row.name}-${row.retryText}-${row.timeoutText}-${index}`}>
              <span>{row.name}</span>
              <span>{row.retryText}</span>
              <span>{row.timeoutText}</span>
            </div>
          ))}
        </div>
      ) : <div className="dshar-hint">{t('builtInNotFound')}</div>}
    </div>
  )
}

/** 将统计分布项安全转换成展示行，兼容 host 返回 label 或原始字段名。 */
function DistributionList({
  items,
  t,
  provider,
}: {
  items: Array<{ label?: unknown; code?: unknown; source?: unknown; provider?: unknown; model?: unknown; count?: unknown }>
  t: (key: string) => string
  provider?: boolean
}) {
  return items.length > 0 ? (
    <ul className="dshar-dashboard-list">
      {items.map((item, index) => {
        const label = provider
          ? [item.label ?? item.provider, item.model].filter((value) => typeof value === 'string' && value).join(' / ')
          : item.label ?? item.code ?? item.source
        return <li key={`${String(label)}-${index}`}><span>{typeof label === 'string' && label ? label : '—'}</span><strong>{displayInteger(item.count)}</strong></li>
      })}
    </ul>
  ) : <div className="dshar-hint">—</div>
}

/** 渲染按需加载的统计看板；折叠区未触发加载按钮时不发请求。 */
function StatsDashboard({ t }: { t: (key: string) => string }) {
  const [range, setRange] = useState<StatsRange>(7)
  const [loaded, setLoaded] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<StatsResponse | null>(null)

  /** 请求当前日期范围的统计数据，失败时仅显示错误文本。 */
  const loadStats = async (nextRange: StatsRange) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/auto-retry/api/stats?days=${nextRange}`)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
      const payload = await response.json() as unknown
      if (!payload || typeof payload !== 'object') throw new Error('invalid response')
      setStats(payload as StatsResponse)
    } catch (loadError) {
      setStats(null)
      setError(formatMessage(t('dashboardError'), { error: loadError instanceof Error ? loadError.message : String(loadError) }))
    } finally {
      setLoading(false)
    }
  }

  // 首次点击加载后，日期筛选变化自动重新拉取；默认状态不会触发请求。
  useEffect(() => {
    if (loaded) void loadStats(range)
  }, [range, loaded, reloadNonce])

  const summary = stats?.summary
  const totalRetries = displayInteger(summary?.totalRetries)
  const autoContinues = displayInteger(summary?.autoContinues)
  const watchdogTriggers = displayInteger(summary?.watchdogTriggers)
  const empty = stats !== null && totalRetries + autoContinues + watchdogTriggers === 0
  const events = Array.isArray(stats?.events) ? stats.events : []
  const byCode = Array.isArray(stats?.byCode) ? stats.byCode : []
  const byProvider = Array.isArray(stats?.byProvider) ? stats.byProvider : []
  const byDay = Array.isArray(stats?.byDay) ? stats.byDay : []

  return (
    <details className="dshar-card dshar-details">
      <summary className="dshar-summary">{t('dashboardTitle')}</summary>
      <div className="dshar-dashboard-toolbar">
        <div className="dshar-dashboard-filters">
          <SegmentedControl
            id="auto-retry-dashboard-range"
            label={t('dashboardTitle')}
            value={String(range) as `${StatsRange}`}
            options={[
              { value: '1', label: t('dashboardToday') },
              { value: '7', label: t('dashboard7Days') },
              { value: '30', label: t('dashboard30Days') },
              { value: '0', label: t('dashboardAll') },
            ]}
            onChange={(value) => setRange(Number(value) as StatsRange)}
          />
          <button className="dshar-button" type="button" disabled={loading} onClick={() => {
            if (!loaded) setLoaded(true)
            else setReloadNonce((current) => current + 1)
          }}>
            {loaded ? t('dashboardRefresh') : t('dashboardLoad')}
          </button>
        </div>
      </div>
      {loading ? <div className="dshar-status" role="status">{t('dashboardLoading')}</div> : null}
      {error ? <div className="dshar-dashboard-error" role="alert">{error}</div> : null}
      {stats && !loading ? (
        empty ? <div className="dshar-hint">{t('dashboardEmpty')}</div> : (
          <>
            <div className="dshar-dashboard-grid">
              {[
                [t('dashboardTotalRetries'), totalRetries],
                [t('dashboardBuiltInRetries'), displayInteger(summary?.builtInRetries)],
                [t('dashboardSupplementalRetries'), displayInteger(summary?.supplementalRetries)],
                [t('dashboardContinues'), autoContinues],
                [t('dashboardWatchdog'), watchdogTriggers],
                [t('dashboardSuccessTurns'), displayInteger(summary?.successTurnsWithRetries ?? summary?.successTurns)],
                [t('dashboardFailedTurns'), displayInteger(summary?.failedTurns)],
                [t('dashboardAverage'), displayNumber(summary?.avgRetriesPerSuccessTurn).toFixed(2)],
              ].map(([label, value]) => (
                <div className="dshar-dashboard-stat" key={String(label)}>
                  <span className="dshar-dashboard-stat-value">{value}</span>
                  <span className="dshar-dashboard-stat-label">{label}</span>
                </div>
              ))}
            </div>
            <div className="dshar-dashboard-columns">
              <div className="dshar-dashboard-subcard">
                <h4 className="dshar-dashboard-subtitle">{t('dashboardByCode')}</h4>
                <DistributionList items={byCode} t={t} />
              </div>
              <div className="dshar-dashboard-subcard">
                <h4 className="dshar-dashboard-subtitle">{t('dashboardByProvider')}</h4>
                <DistributionList items={byProvider} t={t} provider />
              </div>
            </div>
            <div className="dshar-dashboard-subcard">
              <h4 className="dshar-dashboard-subtitle">{t('dashboardByDay')}</h4>
              <div className="dshar-dashboard-table-wrap">
                <table className="dshar-dashboard-table">
                  <thead><tr><th>{t('dashboardDate')}</th><th>{t('dashboardRetries')}</th><th>{t('dashboardContinue')}</th><th>{t('dashboardFailedTurn')}</th></tr></thead>
                  <tbody>{byDay.map((item, index) => <tr key={`${String(item.date)}-${index}`}><td>{typeof item.date === 'string' ? item.date : '—'}</td><td>{displayInteger(item.retries)}</td><td>{displayInteger(item.continues)}</td><td>{displayInteger(item.failedTurns)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div className="dshar-dashboard-subcard">
              <h4 className="dshar-dashboard-subtitle">{t('dashboardDetails')}</h4>
              <div className="dshar-dashboard-table-wrap">
                <table className="dshar-dashboard-table">
                  <thead><tr><th>{t('dashboardTime')}</th><th>{t('dashboardType')}</th><th>{t('dashboardAi')}</th><th>{t('dashboardCode')}</th><th>{t('dashboardAttempt')}</th><th>{t('dashboardSource')}</th><th>{t('dashboardDelay')}</th></tr></thead>
                  <tbody>{events.map((event, index) => {
                    const attempt = event.attempt == null ? '—' : `${displayInteger(event.attempt)}/${displayInteger(event.maxRetries)}`
                    const delay = event.delayMs == null ? '—' : `${(displayNumber(event.delayMs) / 1000).toFixed(2)}${t('dashboardSeconds')}`
                    const ai = [event.provider, event.model].filter((value) => typeof value === 'string' && value).join(' / ')
                    return <tr key={`${String(event.ts)}-${String(event.kind)}-${index}`}><td>{formatEventTime(event.ts)}</td><td>{eventKindLabel(event.kind, t)}</td><td>{ai || '—'}</td><td>{typeof event.code === 'string' ? event.code : '—'}</td><td>{event.kind === 'retry' ? attempt : '—'}</td><td>{event.source === 'built-in' ? t('dashboardBuiltIn') : event.source === 'supplemental' ? t('dashboardSupplemental') : '—'}</td><td>{event.kind === 'retry' ? delay : '—'}</td></tr>
                  })}</tbody>
                </table>
              </div>
            </div>
          </>
        )
      ) : null}
    </details>
  )
}

/* ============================================================
 * 右上角实时通知：shell.overlay 槽位（官方 toast stack 席位）
 * + EventSource 订阅 host 的 SSE 推送 + portal 渲染右上角 toast 栈
 * ============================================================ */

/** SSE 事件帧的最小形状（与 host 端 StatEvent 对齐）。 */
interface NotifyEvent {
  kind?: unknown
  model?: unknown
  provider?: unknown
  code?: unknown
  attempt?: unknown
  maxRetries?: unknown
  outcome?: unknown
}

/** 错误码 → 中文短标签（通知正文用）。 */
const NOTIFY_CODE_LABELS: Record<string, string> = {
  RATE_LIMIT: '限流(429)',
  SERVER: '服务端错误(5xx)',
  TIMEOUT: '响应超时',
  EMPTY_RESPONSE: '空响应',
  TRANSPORT: '网络传输错误',
  UNKNOWN: '未知错误',
  ABORTED: '请求中断',
  MAX_TOKENS: '输出截断',
  IDLE_TIMEOUT: '无响应',
}

/** 把错误码转成展示标签；HTTP_ 前缀与其他未知码有兜底。 */
function notifyCodeLabel(code: unknown): string {
  if (typeof code !== 'string' || code === '') return '故障'
  const direct = NOTIFY_CODE_LABELS[code]
  if (direct) return direct
  if (code.startsWith('HTTP_')) return `HTTP 错误(${code.slice(5)})`
  return code
}

/** 从 outcome 字符串（如 "streak=2"、"idle>180000ms"）提取通知用短语。 */
function notifyOutcomeText(outcome: unknown): string {
  if (typeof outcome !== 'string') return ''
  const streak = outcome.match(/^streak=(\d+)$/)
  if (streak) return streak[1]
  const idle = outcome.match(/^idle>(\d+)ms$/)
  if (idle) return `${Math.round(Number(idle[1]) / 1000)} 秒`
  return ''
}

/** SSE 帧 → 通知条目；不认识的事件返回 null（不弹）。 */
function toToastItem(event: NotifyEvent, id: number, t: (key: string) => string): ToastItem | null {
  const model = typeof event.model === 'string' && event.model !== '' ? event.model : ''
  const aiText = model ? `${event.provider ?? ''}/${model}`.replace(/^\//, '') : typeof event.provider === 'string' ? event.provider : ''
  const aiSuffix = aiText ? `${aiText} · ` : ''
  if (event.kind === 'retry') {
    const attempt = typeof event.attempt === 'number' ? event.attempt : '?'
    const maxRetries = typeof event.maxRetries === 'number' ? event.maxRetries : '?'
    return { id, title: t('toastRetryTitle'), body: `${aiSuffix}${notifyCodeLabel(event.code)}（${attempt}/${maxRetries}）`, tone: 'info' }
  }
  if (event.kind === 'continue') {
    const streakText = notifyOutcomeText(event.outcome)
    const streak = streakText ? formatMessage(t('toastStreak'), { n: streakText }) : ''
    return { id, title: t('toastContinueTitle'), body: `${aiSuffix}${notifyCodeLabel(event.code)}${streak ? ` · ${streak}` : ''}`, tone: 'info' }
  }
  if (event.kind === 'watchdog') {
    const idleText = notifyOutcomeText(event.outcome)
    return { id, title: t('toastWatchdogTitle'), body: `${aiSuffix}${idleText ? `${idleText}无活动，` : ''}已取消请求并准备继续`, tone: 'warn' }
  }
  return null
}

/** 通知栈容量与单条停留时长。 */
const TOAST_MAX = 3
const TOAST_HOLD_MS = 4000

/**
 * 右上角通知栈组件（挂在 shell.overlay 槽位）。
 * 订阅 /auto-retry/api/events 的 SSE 流，按帧入队 toast；每条 4 秒后自动消失。
 */
function NotifyStack({ t, timer }: { t: (key: string) => string; timer: ClientContext['timer'] }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  useEffect(() => {
    const source = new EventSource('/auto-retry/api/events')
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as NotifyEvent
        const item = toToastItem(event, ++counter.current, t)
        if (!item) return
        setToasts((current) => {
          const next = [...current, item]
          // 超出容量丢最旧的
          return next.length > TOAST_MAX ? next.slice(next.length - TOAST_MAX) : next
        })
        timer.timeout(() => {
          setToasts((current) => current.filter((toast) => toast.id !== item.id))
        }, TOAST_HOLD_MS)
      } catch {
        // 无法解析的帧直接忽略
      }
    }
    // EventSource 断线会原生自动重连，这里无需处理 error
    return () => source.close()
  }, [t, timer])

  if (toasts.length === 0) return null
  return createPortal(
    <div className="dshar-toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={toast.tone === 'warn' ? 'dshar-toast dshar-toast-warn' : 'dshar-toast'}>
          <span className="dshar-toast-title">{toast.title}</span>
          <span className="dshar-toast-body">{toast.body}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

/** 渲染完整的自动重试设置页板块，并管理本地草稿。t 由 apply 闭包绑定后传入，不依赖 slot 渲染器注入。 */
function AutoRetrySection({ t, form, describe }: { t: (key: string) => string; form: ConfigForm; describe: ConfigDescribe }) {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot>(() => form.getSnapshot())
  const initialConfig = normalizeConfig(snapshot.value)
  const [draft, setDraft] = useState<AutoRetryConfig>(() => cloneConfig(initialConfig))
  const [baseline, setBaseline] = useState<AutoRetryConfig>(() => cloneConfig(initialConfig))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [saveError, setSaveError] = useState('')
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = !configsEqual(draft, baseline)
  const disabled = !snapshot.writable

  // 订阅 ConfigForm，让外部配置变更能刷新板块快照。
  useEffect(() => {
    setSnapshot(form.getSnapshot())
    return form.subscribe(() => setSnapshot(form.getSnapshot()))
  }, [form])

  // 只有草稿未被用户修改时，才跟随外部快照刷新，避免覆盖未保存输入。
  useEffect(() => {
    if (dirty) return
    const next = normalizeConfig(snapshot.value)
    setDraft(cloneConfig(next))
    setBaseline(cloneConfig(next))
  }, [snapshot.value, dirty])

  // 保存成功提示只显示几秒，并在板块卸载时清理计时器。
  useEffect(() => {
    if (saveState !== 'saved') return
    savedTimer.current = setTimeout(() => setSaveState('idle'), 3000)
    return () => {
      if (savedTimer.current !== undefined) clearTimeout(savedTimer.current)
    }
  }, [saveState])

  /** 更新单条规则的草稿值。 */
  const updateRule = (code: string, patch: Partial<RetryRule>) => {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.code === code ? { ...rule, ...patch } : rule)),
    }))
    setSaveState('idle')
  }

  /** 保存完整草稿；一次 mutate 原子写入五个顶层字段。 */
  const saveDraft = async () => {
    if (disabled || !dirty || saveState === 'saving') return
    setSaveState('saving')
    setSaveError('')
    try {
      // 已核实 ConfigForm.set(field, value) 会转成 { op: "set", path: [field], value }。
      // mutate 会串行使用 pendingRevision ?? 当前 snapshot.revision，并在冲突后自动重读；
      // 因此这里一次提交完整的五个顶层字段，既保持 revision 围栏，也避免逐字段中间状态。
      const ok = await form.mutate([
        { op: 'set', path: ['enabled'], value: draft.enabled },
        { op: 'set', path: ['notify'], value: draft.notify },
        { op: 'set', path: ['rules'], value: draft.rules },
        { op: 'set', path: ['mainAgent'], value: draft.mainAgent },
        { op: 'set', path: ['subAgent'], value: draft.subAgent },
        { op: 'set', path: ['backoff'], value: draft.backoff },
      ])
      if (!ok) {
        setSaveError('写入被拒绝（revision 冲突或校验失败）')
        setSaveState('failed')
        return
      }
      const next = normalizeConfig(form.getSnapshot().value ?? draft)
      setDraft(cloneConfig(next))
      setBaseline(cloneConfig(next))
      setSaveState('saved')
    } catch (error) {
      // 展示 wire 层错误详情，便于诊断 host 端拒绝原因
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaveState('failed')
    }
  }

  /** 放弃本地草稿并重新读取当前 ConfigForm 快照。 */
  const discardDraft = () => {
    const next = normalizeConfig(form.getSnapshot().value)
    setDraft(cloneConfig(next))
    setBaseline(cloneConfig(next))
    setSaveState('idle')
  }

  return (
    <section className="dshar-root" aria-label={t('nav')}>
      <div className="dshar-intro">
        <div className="dshar-intro-title">{t('nav')}</div>
        <div className="dshar-intro-copy">{t('intro')}</div>
        <ul className="dshar-layer-list dshar-intro-copy">
          <li>{t('layerRequest')}</li>
          <li>{t('layerContinue')}</li>
          <li>{t('layerWatchdog')}</li>
        </ul>
      </div>

      <ExplanationCard t={t} />
      <BuiltInStrategyCard t={t} describe={describe} />

      {!snapshot.writable ? <div className="dshar-unavailable">{t('unavailable')}</div> : null}

      <div className="dshar-card">
        <h3 className="dshar-card-title">{t('nav')}</h3>
        <ToggleRow
          label={t('enabled')}
          desc={t('enabledDesc')}
          checked={draft.enabled}
          onChange={(enabled) => {
            setDraft((current) => ({ ...current, enabled }))
            setSaveState('idle')
          }}
          disabled={disabled}
        />
        <ToggleRow
          label={t('notify')}
          desc={t('notifyDesc')}
          checked={draft.notify}
          onChange={(notify) => {
            setDraft((current) => ({ ...current, notify }))
            setSaveState('idle')
          }}
          disabled={disabled}
        />
      </div>

      <div className="dshar-card">
        <h3 className="dshar-card-title">{t('triggerSection')}</h3>
        {draft.rules.map((rule) => (
          <RuleRow key={rule.code} rule={rule} t={t} disabled={disabled} onChange={(patch) => updateRule(rule.code, patch)} />
        ))}
      </div>

      <div className="dshar-card">
        <h3 className="dshar-card-title">{t('mainAgent')}</h3>
        <ToggleRow
          label={t('requestRetry')}
          desc={t('requestRetryDesc')}
          checked={draft.mainAgent.requestRetry}
          onChange={(requestRetry) => {
            setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, requestRetry } }))
            setSaveState('idle')
          }}
          disabled={disabled}
        />
        <ToggleRow
          label={t('autoContinue')}
          desc={t('autoContinueDesc')}
          checked={draft.mainAgent.autoContinue}
          onChange={(autoContinue) => {
            setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, autoContinue } }))
            setSaveState('idle')
          }}
          disabled={disabled}
        />
        {draft.mainAgent.autoContinue ? (
          <div className="dshar-subfield">
            <Field label={t('continueDelay')} hint={t('continueDelayHint')}>
              <div className="dshar-unit">
                <Input
                  className="dshar-number"
                  type="number"
                  min={0}
                  max={600}
                  step={0.1}
                  value={millisecondsToSeconds(draft.mainAgent.continueDelayMs)}
                  aria-label={t('continueDelay')}
                  title={t('tooltipContinueDelay')}
                  disabled={disabled}
                  onChange={(event) => {
                    const continueDelayMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 0, 600, draft.mainAgent.continueDelayMs)
                    setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, continueDelayMs } }))
                    setSaveState('idle')
                  }}
                />
                <span className="dshar-hint">{t('seconds')}</span>
              </div>
            </Field>
            <Field label={t('maxConsecutive')} hint={t('maxConsecutiveHint')}>
              <Input
                className="dshar-number"
                type="number"
                min={1}
                max={50}
                step={1}
                value={draft.mainAgent.maxConsecutive}
                aria-label={t('maxConsecutive')}
                title={t('tooltipMaxConsecutive')}
                disabled={disabled}
                onChange={(event) => {
                  const maxConsecutive = clampInteger(event.currentTarget.valueAsNumber, 1, 50, draft.mainAgent.maxConsecutive)
                  setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, maxConsecutive } }))
                  setSaveState('idle')
                }}
              />
            </Field>
            <Field label={t('continueMessage')} hint={t('continueMessageHint')}>
              <Input
                className="dshar-text"
                type="text"
                value={draft.mainAgent.continueMessage}
                aria-label={t('continueMessage')}
                title={t('tooltipContinueMessage')}
                disabled={disabled}
                onChange={(event) => {
                  const continueMessage = event.currentTarget.value
                  setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, continueMessage } }))
                  setSaveState('idle')
                }}
              />
            </Field>
          </div>
        ) : null}
        <ToggleRow
          label={t('idleWatchdog')}
          desc={t('idleWatchdogDesc')}
          checked={draft.mainAgent.idleWatchdog}
          onChange={(idleWatchdog) => {
            setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, idleWatchdog } }))
            setSaveState('idle')
          }}
          disabled={disabled}
        />
        {draft.mainAgent.idleWatchdog ? (
          <div className="dshar-subfield">
            <Field label={t('idleTimeout')} hint={t('idleTimeoutHint')}>
              <div className="dshar-unit">
                <Input
                  className="dshar-number"
                  type="number"
                  min={30}
                  max={600}
                  step={1}
                  value={millisecondsToSeconds(draft.mainAgent.idleTimeoutMs)}
                  aria-label={t('idleTimeout')}
                  title={t('tooltipIdleTimeout')}
                  disabled={disabled}
                  onChange={(event) => {
                    const idleTimeoutMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 30, 600, draft.mainAgent.idleTimeoutMs)
                    setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, idleTimeoutMs } }))
                    setSaveState('idle')
                  }}
                />
                <span className="dshar-hint">{t('seconds')}</span>
              </div>
            </Field>
          </div>
        ) : null}
        <ToggleRow
          label={t('continueOnMaxTokens')}
          desc={t('continueOnMaxTokensDesc')}
          checked={draft.mainAgent.continueOnMaxTokens}
          onChange={(continueOnMaxTokens) => {
            setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, continueOnMaxTokens } }))
            setSaveState('idle')
          }}
          disabled={disabled}
        />
      </div>

      <div className="dshar-card">
        <h3 className="dshar-card-title">{t('subAgent')}</h3>
        <ToggleRow
          label={t('requestRetry')}
          desc={t('subAgentDesc')}
          checked={draft.subAgent.requestRetry}
          onChange={(requestRetry) => {
            setDraft((current) => ({ ...current, subAgent: { ...current.subAgent, requestRetry } }))
            setSaveState('idle')
          }}
          disabled={disabled}
        />
        <div className="dshar-subblock">
          <span className="dshar-hint">{t('subAgentHint')}</span>
          <span className="dshar-hint">{t('subAgentHint2')}</span>
          <span className="dshar-hint">{t('subAgentHint3')}</span>
        </div>
      </div>

      <details className="dshar-card dshar-details">
        <summary className="dshar-summary">{t('advanced')}</summary>
        <div className="dshar-segmented" title={t('backoffHint')}>
          <span className="dshar-field-label"><span>{t('intervalMode')}</span><span className="dshar-hint">{t('backoffHint')}</span></span>
          <SegmentedControl
            id="auto-retry-interval-mode"
            label={t('intervalMode')}
            value={draft.backoff.intervalMode}
            options={[
              { value: 'exponential', label: t('intervalExponential'), title: t('backoffHint') },
              { value: 'fixed', label: t('intervalFixed'), title: t('backoffHint') },
            ]}
            disabled={disabled}
            onChange={(intervalMode) => {
              setDraft((current) => ({ ...current, backoff: { ...current.backoff, intervalMode } }))
              setSaveState('idle')
            }}
          />
        </div>
        {draft.backoff.intervalMode === 'exponential' ? (
          <>
            <Field label={t('backoffInitial')} hint={t('backoffInitialHint')}>
              <div className="dshar-unit">
                <Input
                  className="dshar-number"
                  type="number"
                  min={0.1}
                  max={60}
                  step={0.1}
                  value={millisecondsToSeconds(draft.backoff.initialDelayMs)}
                  aria-label={t('backoffInitial')}
                  title={t('backoffHint')}
                  disabled={disabled}
                  onChange={(event) => {
                    const initialDelayMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 0.1, 60, draft.backoff.initialDelayMs)
                    setDraft((current) => ({ ...current, backoff: { ...current.backoff, initialDelayMs } }))
                    setSaveState('idle')
                  }}
                />
                <span className="dshar-hint">{t('seconds')}</span>
              </div>
            </Field>
            <Field label={t('backoffMax')} hint={t('backoffMaxHint')}>
              <div className="dshar-unit">
                <Input
                  className="dshar-number"
                  type="number"
                  min={1}
                  max={300}
                  step={0.1}
                  value={millisecondsToSeconds(draft.backoff.maxDelayMs)}
                  aria-label={t('backoffMax')}
                  title={t('backoffHint')}
                  disabled={disabled}
                  onChange={(event) => {
                    const maxDelayMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 1, 300, draft.backoff.maxDelayMs)
                    setDraft((current) => ({ ...current, backoff: { ...current.backoff, maxDelayMs } }))
                    setSaveState('idle')
                  }}
                />
                <span className="dshar-hint">{t('seconds')}</span>
              </div>
            </Field>
          </>
        ) : (
          <Field label={t('fixedDelay')} hint={t('fixedDelayHint')}>
            <div className="dshar-unit">
              <Input
                className="dshar-number"
                type="number"
                min={0.1}
                max={600}
                step={0.1}
                value={millisecondsToSeconds(draft.backoff.fixedDelayMs)}
                aria-label={t('fixedDelay')}
                title={t('backoffHint')}
                disabled={disabled}
                onChange={(event) => {
                  const fixedDelayMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 0.1, 600, draft.backoff.fixedDelayMs)
                  setDraft((current) => ({ ...current, backoff: { ...current.backoff, fixedDelayMs } }))
                  setSaveState('idle')
                }}
              />
              <span className="dshar-hint">{t('seconds')}</span>
            </div>
          </Field>
        )}
      </details>

      <StatsDashboard t={t} />

      <div className="dshar-actions">
        <button className="dshar-button" type="button" disabled={disabled || !dirty || saveState === 'saving'} onClick={saveDraft}>
          {t('save')}
        </button>
        <button className="dshar-button" type="button" disabled={disabled || !dirty || saveState === 'saving'} onClick={discardDraft}>
          {t('discard')}
        </button>
        {saveState === 'saved' ? <span className="dshar-status" role="status">{t('saved')}</span> : null}
        {saveState === 'failed' ? <span className="dshar-status" role="alert" title={saveError}>{t('saveFailed')}{saveError ? `（${saveError}）` : ''}</span> : null}
        {!snapshot.writable && snapshot.status === 'loading' ? <span className="dshar-status">{t('loading')}</span> : null}
      </div>

      {/* 页脚：版本 / 作者 / 仓库入口 */}
      <div className="dshar-footer">
        <span>{formatMessage(t('footerVersion'), { version: __DSHAR_VERSION__ })}</span>
        <span>·</span>
        <span>{t('footerBy')}</span>
        <span>·</span>
        <a href="https://github.com/zxmqq1234/dsh-auto-retry" target="_blank" rel="noreferrer">{t('footerGithub')}</a>
      </div>
    </section>
  )
}

/** 插件名称，供 dsh bundle 识别。 */
export const name = 'dsh-auto-retry'

/** 插件所需的 cordis 服务。 */
export const inject = ['slots', 'locale', 'configForms', 'timer']

/** 注册双语文案、设置板块和一次性样式。 */
export function apply(ctx: ClientContext): void {
  const form = ctx.configForms.get('auto-retry')
  const describe = ctx.configForms.describe()
  const t = ctx.locale.bind(NS)

  // locale 注册包在 effect 中，确保插件重载时旧注册先被卸载，避免同名空间冲突。
  ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'auto-retry: locale zh')
  ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'auto-retry: locale en')

  // 样式只注入一次，并在插件卸载时移除对应 style 节点。
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-auto-retry'
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => style.remove()
  }, 'auto-retry: styles')

  // 注册独立的设置页板块；t 与 form 通过闭包硬传入组件，不依赖渲染器的 props 注入。
  const Section = () => <AutoRetrySection t={t} form={form} describe={describe} />
  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'auto-retry',
            order: 50,
            locale: NS,
            label: () => t('nav'),
            inject: () => ({}),
          },
          Section,
        ),
      ),
    'auto-retry: settings section',
  )

  // 右上角实时通知：注册到 shell.overlay（官方 toast stack 席位），SSE 订阅 host 推送。
  const Notify = () => <NotifyStack t={t} timer={ctx.timer} />
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'auto-retry-toast', order: 30 }, Notify),
      ),
    'auto-retry: overlay notifications',
  )
}
