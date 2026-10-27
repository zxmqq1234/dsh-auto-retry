import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { apply } from '../lib/index.js'

const DEFAULT_CONFIG = {
  enabled: true,
  notify: true,
  rules: [
    { code: 'RATE_LIMIT', enabled: true, maxRetries: 2 },
    { code: 'SERVER', enabled: true, maxRetries: 2 },
    { code: 'TIMEOUT', enabled: true, maxRetries: 2 },
    { code: 'EMPTY_RESPONSE', enabled: true, maxRetries: 1 },
    { code: 'TRANSPORT', enabled: true, maxRetries: 3 },
    { code: 'UNKNOWN', enabled: true, maxRetries: 2 },
    { code: 'HTTP_4XX', enabled: false, maxRetries: 1 },
    { code: 'ABORTED', enabled: false, maxRetries: 1 },
  ],
  mainAgent: {
    requestRetry: true,
    autoContinue: true,
    continueDelayMs: 5_000,
    maxConsecutive: 5,
    continueMessage: '继续',
    idleWatchdog: false,
    idleTimeoutMs: 180_000,
    continueOnMaxTokens: false,
  },
  subAgent: { requestRetry: true },
  backoff: {
    intervalMode: 'fixed',
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    fixedDelayMs: 100,
  },
}

/** Create an isolated host context and temporary statistics directory. */
function createFixture(overrides = {}) {
  const previousHome = process.env.DSH_HOME
  const statsHome = mkdtempSync(join(tmpdir(), 'dsh-auto-retry-test-'))
  process.env.DSH_HOME = statsHome
  const listeners = new Map()
  const disposers = []
  const eventStore = new Map()
  const warnings = []
  const routes = []
  const liveAgents = new Map((overrides.runningAgents ?? []).map((agent) => [agent.id, agent]))
  const config = {
    ...DEFAULT_CONFIG,
    ...overrides,
    mainAgent: { ...DEFAULT_CONFIG.mainAgent, ...overrides.mainAgent },
    backoff: { ...DEFAULT_CONFIG.backoff, ...overrides.backoff },
    rules: overrides.rules ?? DEFAULT_CONFIG.rules.map((rule) => ({ ...rule })),
  }
  const ctx = {
    agents: {
      get: (id) => liveAgents.get(id),
      list: () => [...liveAgents.values()],
    },
    sessionProjections: {
      stateOf() { return eventStore },
      register() {
        return () => {}
      },
    },
    logger: () => ({ info() {}, warn(...args) { warnings.push(args) } }),
    on(name, listener) {
      const handlers = listeners.get(name) ?? []
      handlers.push(listener)
      listeners.set(name, handlers)
      return () => {}
    },
    effect(setup) {
      const cleanup = setup()
      if (typeof cleanup === 'function') disposers.push(cleanup)
      return () => {}
    },
    inject(_services, callback) {
      callback({
        webServer: {
          register(route) {
            routes.push(route)
            return () => {}
          },
        },
      })
    },
  }
  apply(ctx, config)

  return {
    config,
    listeners,
    warnings,
    eventStore,
    liveAgents,
    routes,
    async dispose({ keepStats = false } = {}) {
      for (const disposer of disposers.reverse()) await disposer()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      if (!keepStats) {
        for (const name of readdirSync(statsHome)) unlinkSync(join(statsHome, name))
        rmdirSync(statsHome)
      }
    },
    cleanupStats() {
      for (const name of readdirSync(statsHome)) unlinkSync(join(statsHome, name))
      rmdirSync(statsHome)
    },
    statsPath: join(statsHome, 'auto-retry-stats.json'),
  }
}

/** Run a case with deterministic timers and always disable the fake clock. */
async function withFakeTimers(operation) {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await operation()
  } finally {
    mock.timers.reset()
  }
}

function createAgent(id, header = {}, eventStore = new Map()) {
  const events = []
  return {
    id,
    status: 'idle',
    session: {
      id,
      header,
      append(type, data) {
        if (type === 'llm/retry') {
          const retryKey = JSON.stringify([data.provider, data.policyKey])
          const current = eventStore.get(retryKey)
          if (current?.retry !== data.retry || current?.retryId !== data.retryId) {
            eventStore.set(retryKey, { retry: data.retry, retryId: data.retryId })
          }
        }
        events.push({ type, data })
      },
    },
    events,
    followups: [],
    cancellations: [],
    followup(message) { this.followups.push(message) },
    cancel(cause, options) { this.cancellations.push({ cause, options }) },
  }
}

test('HTTP_4XX retry budget is shared across matching status codes', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({
      rules: [{ code: 'HTTP_4XX', enabled: true, maxRetries: 1 }],
    })
    try {
      const agent = createAgent('http-budget', {}, fixture.eventStore)
      const signal = new AbortController().signal
      let delegated = 0
      const handler = fixture.listeners.get('agent/request-error')[0]
      const sendFailure = async (code) => handler({
        agent,
        turn: 1,
        step: 1,
        provider: 'mock',
        failure: { code, message: code },
        signal,
      }, async () => { delegated += 1 })

      const first = sendFailure('HTTP_404')
      await Promise.resolve()
      mock.timers.tick(200)
      const firstResult = await first
      assert.deepEqual(fixture.warnings, [])
      assert.deepEqual(firstResult, { kind: 'retry' })
      assert.equal(await sendFailure('HTTP_409'), undefined)
      assert.equal(delegated, 1)
      assert.equal(agent.events.filter((event) => event.type === 'llm/retry').length, 1)
    } finally {
      await fixture.dispose()
    }
  })
})

/**
 * 按 dsh 会话加载器（@deepseek-ai/dsh-llm-retry invariant）的规则校验事件流：
 * 1. 同一条策略链（turn+step+provider+policyKey）内 retryId 恒定；
 * 2. 链内 retry 从 1 连续递增且不超过 maxRetries；
 * 3. retryId 不得跨链重复；
 * 4. llm/retry-started 与已排程 (retryId, retry) 一一配对。
 * 回归 v0.3.0 缺陷：预算计数被误用作链内序号，重启后会话历史整体无法加载。
 */
function assertRetryChainInvariants(agent) {
  const retries = agent.events.filter((event) => event.type === 'llm/retry')
  const chainLast = new Map()
  const chainOwner = new Map()
  for (const event of retries) {
    const { retryId, turn, step, provider, policyKey, retry, maxRetries } = event.data
    const chain = `${turn}:${step}:${provider}:${policyKey}`
    const last = chainLast.get(chain)
    if (last === undefined) {
      assert.equal(retry, 1, `chain ${chain} must start its attempt sequence at 1`)
      assert.equal(chainOwner.has(retryId), false, `retryId ${retryId} is owned by another chain`)
      chainOwner.set(retryId, chain)
    } else {
      assert.equal(retryId, last.retryId, `chain ${chain} must keep one retryId`)
      assert.equal(retry, last.retry + 1, `chain ${chain} must count attempts consecutively`)
    }
    assert.ok(retry <= maxRetries, `retry ${retry} must not exceed maxRetries ${maxRetries}`)
    chainLast.set(chain, { retryId, retry })
  }
  const scheduled = new Set(retries.map((event) => `${event.data.retryId}#${event.data.retry}`))
  const startedSeen = new Set()
  for (const event of agent.events.filter((item) => item.type === 'llm/retry-started')) {
    const key = `${event.data.retryId}#${event.data.retry}`
    assert.ok(scheduled.has(key), `retry-started ${key} pairs no scheduled attempt`)
    assert.equal(startedSeen.has(key), false, `retry-started repeats ${key}`)
    startedSeen.add(key)
  }
}

/** Build a request-error invocation against one agent with fixed turn/step/provider. */
function sendSupplementalFailure(fixture, agent, { turn, step, provider = 'mock', code, message }, signal) {
  const handler = fixture.listeners.get('agent/request-error')[0]
  return handler({ agent, turn, step, provider, failure: { code, message }, signal }, async () => undefined)
}

test('supplemental retries keep one retryId and consecutive attempts per policy chain', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({
      rules: [{ code: 'SERVER', enabled: true, maxRetries: 2 }],
    })
    try {
      const agent = createAgent('session-abcdef12-chain', {}, fixture.eventStore)
      const signal = new AbortController().signal

      const first = sendSupplementalFailure(fixture, agent, { turn: 7, step: 84, code: 'SERVER', message: '502' }, signal)
      await Promise.resolve()
      mock.timers.tick(200)
      assert.deepEqual(await first, { kind: 'retry' })
      const second = sendSupplementalFailure(fixture, agent, { turn: 7, step: 84, code: 'SERVER', message: '502' }, signal)
      await Promise.resolve()
      mock.timers.tick(200)
      assert.deepEqual(await second, { kind: 'retry' })

      const retries = agent.events.filter((event) => event.type === 'llm/retry')
      assert.equal(retries.length, 2)
      assert.equal(retries[0].data.retryId, retries[1].data.retryId)
      assert.deepEqual(retries.map((event) => event.data.retry), [1, 2])
      assertRetryChainInvariants(agent)
    } finally {
      await fixture.dispose()
    }
  })
})

test('global infinite retry keeps chain invariants while exceeding maxRetries', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({
      infiniteRetry: true,
      rules: [{ code: 'SERVER', enabled: true, maxRetries: 1 }],
    })
    try {
      const agent = createAgent('session-infinite-global', {}, fixture.eventStore)
      const signal = new AbortController().signal
      for (let i = 1; i <= 5; i += 1) {
        const pending = sendSupplementalFailure(fixture, agent, { turn: 3, step: 9, code: 'SERVER', message: '502' }, signal)
        await Promise.resolve()
        mock.timers.tick(200)
        assert.deepEqual(await pending, { kind: 'retry' }, `attempt ${i} must retry despite maxRetries=1`)
      }
      const retries = agent.events.filter((event) => event.type === 'llm/retry')
      assert.deepEqual(retries.map((event) => event.data.retry), [1, 2, 3, 4, 5])
      assert.ok(retries.every((event) => event.data.maxRetries >= 1000), 'infinite retries must write the finite sentinel as maxRetries')
      assertRetryChainInvariants(agent)
    } finally {
      await fixture.dispose()
    }
  })
})

test('per-rule infinite retry ignores only its own maxRetries', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({
      rules: [{ code: 'SERVER', enabled: true, maxRetries: 1, infinite: true }],
    })
    try {
      const agent = createAgent('session-infinite-rule', {}, fixture.eventStore)
      const signal = new AbortController().signal
      for (let i = 1; i <= 3; i += 1) {
        const pending = sendSupplementalFailure(fixture, agent, { turn: 1, step: 1, code: 'SERVER', message: '502' }, signal)
        await Promise.resolve()
        mock.timers.tick(200)
        assert.deepEqual(await pending, { kind: 'retry' }, `infinite rule must retry beyond maxRetries=1 (attempt ${i})`)
      }
      const retries = agent.events.filter((event) => event.type === 'llm/retry')
      assert.equal(retries.length, 3)
      assert.ok(retries.every((event) => event.data.maxRetries >= 1000))
      assertRetryChainInvariants(agent)
    } finally {
      await fixture.dispose()
    }
  })
})

test('infinite continue disables the consecutive-failure fuse', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({
      mainAgent: { maxConsecutive: 1, infiniteContinue: true, continueDelayMs: 100 },
    })
    try {
      const agent = createAgent('infinite-continue')
      fixture.liveAgents.set(agent.id, agent)
      const onSessionEvent = fixture.listeners.get('session/event')[0]
      // 熔断上限为 1，但无限连续失败开启：连续三次终局失败都应排定并发送继续
      for (let i = 1; i <= 3; i += 1) {
        onSessionEvent(agent.session, { type: 'turn/end', data: { turn: i, reason: { kind: 'error', error: { code: 'UNKNOWN' } } } })
        mock.timers.tick(200)
        agent.status = 'idle'
      }
      assert.equal(agent.followups.length, 3)
    } finally {
      await fixture.dispose()
    }
  })
})

test('retry attempts restart at 1 for each new step despite a shared budget', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({
      rules: [{ code: 'SERVER', enabled: true, maxRetries: 2 }],
    })
    try {
      const agent = createAgent('session-abcdef12-step', {}, fixture.eventStore)
      const signal = new AbortController().signal

      const firstStep = sendSupplementalFailure(fixture, agent, { turn: 1, step: 1, code: 'SERVER', message: '502' }, signal)
      await Promise.resolve()
      mock.timers.tick(200)
      assert.deepEqual(await firstStep, { kind: 'retry' })

      // 同回合的新 step 首次重试：预算跨 step 共享（已用 1/2），但链内序号必须从 1 开始——
      // v0.3.0 在此处写出 retry=2，链首跳号导致整份会话无法加载
      const secondStep = sendSupplementalFailure(fixture, agent, { turn: 1, step: 2, code: 'SERVER', message: '502' }, signal)
      await Promise.resolve()
      mock.timers.tick(200)
      assert.deepEqual(await secondStep, { kind: 'retry' })

      const retries = agent.events.filter((event) => event.type === 'llm/retry')
      assert.equal(retries.length, 2)
      assert.deepEqual(retries.map((event) => event.data.retry), [1, 1])
      assert.notEqual(retries[0].data.retryId, retries[1].data.retryId)
      assertRetryChainInvariants(agent)
    } finally {
      await fixture.dispose()
    }
  })
})

test('policy chain capacity stops retries when failure codes rotate within one step', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({
      rules: [
        { code: 'SERVER', enabled: true, maxRetries: 1 },
        { code: 'TIMEOUT', enabled: true, maxRetries: 1 },
      ],
    })
    try {
      const agent = createAgent('session-abcdef12-rotate', {}, fixture.eventStore)
      const signal = new AbortController().signal

      const serverFailure = sendSupplementalFailure(fixture, agent, { turn: 1, step: 1, code: 'SERVER', message: '502' }, signal)
      await Promise.resolve()
      mock.timers.tick(200)
      assert.deepEqual(await serverFailure, { kind: 'retry' })

      // 重发后错误码轮换（502 重试后超时）：TIMEOUT 预算未尽，但链内序号将到 2，
      // 超过 maxRetries=1 会被加载器拒绝——链容量闸门必须放行终局而不是写超额事件
      const timeoutFailure = sendSupplementalFailure(fixture, agent, { turn: 1, step: 1, code: 'TIMEOUT', message: 'timed out' }, signal)
      await Promise.resolve()
      mock.timers.tick(200)
      assert.equal(await timeoutFailure, undefined)

      const retries = agent.events.filter((event) => event.type === 'llm/retry')
      assert.equal(retries.length, 1)
      assert.equal(retries[0].data.retry, 1)
      assertRetryChainInvariants(agent)
    } finally {
      await fixture.dispose()
    }
  })
})

test('a cancelled supplemental retry keeps its chain attempt for the next retry', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({
      rules: [{ code: 'SERVER', enabled: true, maxRetries: 2 }],
    })
    try {
      const agent = createAgent('session-abcdef12-cancel', {}, fixture.eventStore)
      const controller = new AbortController()

      const cancelled = sendSupplementalFailure(fixture, agent, { turn: 1, step: 1, code: 'SERVER', message: '502' }, controller.signal)
      await Promise.resolve()
      controller.abort()
      assert.equal(await cancelled, undefined)

      // 排程事件已入会话历史，链内序号已消耗且必须保持连续——下一次重试接着写 retry=2
      const retried = sendSupplementalFailure(fixture, agent, { turn: 1, step: 1, code: 'SERVER', message: '502' }, new AbortController().signal)
      await Promise.resolve()
      mock.timers.tick(200)
      assert.deepEqual(await retried, { kind: 'retry' })

      const retries = agent.events.filter((event) => event.type === 'llm/retry')
      assert.deepEqual(retries.map((event) => event.data.retry), [1, 2])
      assert.equal(retries[0].data.retryId, retries[1].data.retryId)
      assertRetryChainInvariants(agent)
    } finally {
      await fixture.dispose()
    }
  })
})

test('new user input cancels a pending automatic continuation', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({ mainAgent: { continueDelayMs: 100 } })
    try {
      const agent = createAgent('manual-intervention')
      fixture.liveAgents.set(agent.id, agent)
      const onSessionEvent = fixture.listeners.get('session/event')[0]
      onSessionEvent(agent.session, {
        type: 'turn/end',
        data: { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN' } } },
      })
      fixture.listeners.get('agent/inbox/inserted')[0]({
        agent,
        message: { id: 'user-1', role: 'user', source: { kind: 'user' } },
      })
      mock.timers.tick(1_000)
      assert.equal(agent.followups.length, 0)
    } finally {
      await fixture.dispose()
    }
  })
})

test('watchdog hot updates arm and replace the running agent timer', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture({ mainAgent: { idleTimeoutMs: 100 } })
    try {
      const agent = createAgent('watchdog-hot-update')
      agent.status = 'running'
      fixture.liveAgents.set(agent.id, agent)
      fixture.listeners.get('agent/status')[0]({ agent, status: 'running' })
      fixture.config.mainAgent.idleWatchdog = true
      fixture.listeners.get('loader/volatile-update')[0]()
      mock.timers.tick(99)
      assert.equal(agent.cancellations.length, 0)

      fixture.config.mainAgent.idleTimeoutMs = 50
      fixture.listeners.get('loader/volatile-update')[0]()
      mock.timers.tick(49)
      assert.equal(agent.cancellations.length, 0)
      mock.timers.tick(1)
      assert.equal(agent.cancellations.length, 1)
      assert.equal(agent.cancellations[0].cause.kind, 'hook')
    } finally {
      await fixture.dispose()
    }
  })
})

test('plugin mount arms a watchdog for an already-running main agent', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const agent = createAgent('already-running')
    agent.status = 'running'
    const fixture = createFixture({
      mainAgent: { idleWatchdog: true, idleTimeoutMs: 100 },
      runningAgents: [agent],
    })
    try {
      fixture.liveAgents.set(agent.id, agent)
      mock.timers.tick(100)
      assert.equal(agent.cancellations.length, 1)
      assert.equal(agent.cancellations[0].cause.kind, 'hook')
    } finally {
      await fixture.dispose()
    }
  })
})

test('unloading the plugin cancels an in-flight supplemental retry wait', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture()
    const agent = createAgent('dispose-during-retry')
    const handler = fixture.listeners.get('agent/request-error')[0]
    const pending = handler({
      agent,
      turn: 1,
      step: 1,
      provider: 'mock',
      failure: { code: 'RATE_LIMIT', message: 'rate limited' },
      signal: new AbortController().signal,
    }, async () => undefined)

    await fixture.dispose()
    assert.equal(await pending, undefined)
    assert.equal(agent.events.some((event) => event.type === 'llm/retry-started'), false)
  })
})

test('dashboard counts only error turns as failures', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture()
    try {
      const agent = createAgent('stats-outcomes')
      const onSessionEvent = fixture.listeners.get('session/event')[0]
      for (const [turn, kind] of [[1, 'aborted'], [2, 'max-tokens'], [3, 'blocked'], [4, 'error']]) {
        onSessionEvent(agent.session, { type: 'turn/end', data: { turn, reason: { kind } } })
      }

      const statsRoute = fixture.routes.find((route) => route.path === '/auto-retry')
      let report
      await statsRoute.handler({ url: '/auto-retry/api/stats?days=0' }, {
        writeHead() {},
        end(body) { report = JSON.parse(body) },
      })
      assert.equal(report.summary.failedTurns, 1)
      assert.equal(report.byDay.reduce((sum, day) => sum + day.failedTurns, 0), 1)
      assert.equal(report.events.filter((event) => event.kind === 'turn-end').length, 4)
      fixture.listeners.get('session/event')[0](agent.session, {
        type: 'turn/end',
        data: { turn: 5, reason: { kind: 'completed' } },
      })
      let successfulReport
      await statsRoute.handler({ url: '/auto-retry/api/stats?days=0' }, {
        writeHead() {},
        end(body) { successfulReport = JSON.parse(body) },
      })
      assert.equal(successfulReport.summary.successTurnsWithRetries, 0)
    } finally {
      await fixture.dispose()
    }
  })
})

test('statistics snapshot is atomically flushed during plugin disposal', { concurrency: false }, async () => {
  await withFakeTimers(async () => {
    const fixture = createFixture()
    const agent = createAgent('flush-stats')
    fixture.listeners.get('session/event')[0](agent.session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN' } } },
    })
    await fixture.dispose({ keepStats: true })
    const document = JSON.parse(readFileSync(fixture.statsPath, 'utf8'))
    assert.equal(document.version, 1)
    assert.equal(document.events[0].outcome, 'error')
    fixture.cleanupStats()
  })
})

test('plugin source includes a stale-write revision fence', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /\], baselineRevision\)/)
  assert.match(source, /notify: typeof source\.notify === 'boolean'/)
  assert.match(source, /const events = Array\.isArray\(stats\?\.events\)[\s\S]*?const empty = stats !== null/)
})

test('host retry buckets do not duplicate or parse serialized keys', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /function retryBucketKey\(/)
  assert.equal((source.match(/function clearRetryBucketsOfSession\(/g) ?? []).length, 1)
  assert.match(source, /const retryBuckets = new Map<string, Map<number, Map<string, number>>>/)
  assert.doesNotMatch(source, /JSON\.parse\(key\)/)
})

test('client request generations prevent stale dashboard results and defer first fetch', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /generation === requestGeneration\.current/)
  assert.match(source, /requestGeneration\.current \+= 1/)
  assert.match(source, /loaded && expanded && requestedRange === range/)
  assert.match(source, /setRequestedRange\(range\)/)
})

test('retry budgets use nested maps rather than serialized key parsing', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(source, /new Map<string, Map<number, Map<string, number>>>/)
  assert.doesNotMatch(source, /JSON\.parse\(key\)/)
})

test('client bundle imports the React portal from the React DOM seed', () => {
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /require\("react-dom"\)/)
  assert.doesNotMatch(bundle, /require\("react-dom\/client"\).*createPortal/)
})

test('always retry policy does not display a bounded retry-code list', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /policy\?\.mode === 'always'\s*\? \[t\('builtInAnyFailure'\)\]/)
})
