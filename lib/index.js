import { randomUUID } from "node:crypto";
import { existsSync, mkdir as mkdirAsync, readFileSync, rename as renameAsync, unlink as unlinkAsync, writeFile as writeFileAsync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import Schema from "@deepseek-ai/schemastery";
const mkdir = promisify(mkdirAsync);
const rename = promisify(renameAsync);
const unlink = promisify(unlinkAsync);
const writeFile = promisify(writeFileAsync);
function unwrapDeep(value) {
  if (value && typeof value.get === "function") {
    return unwrapDeep(value.get());
  }
  if (Array.isArray(value)) return value.map((item) => unwrapDeep(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = unwrapDeep(item);
    }
    return out;
  }
  return value;
}
const DEFAULT_RULES = [
  { code: "RATE_LIMIT", enabled: true, maxRetries: 2 },
  { code: "SERVER", enabled: true, maxRetries: 2 },
  { code: "TIMEOUT", enabled: true, maxRetries: 2 },
  { code: "EMPTY_RESPONSE", enabled: true, maxRetries: 1 },
  { code: "TRANSPORT", enabled: true, maxRetries: 3 },
  { code: "UNKNOWN", enabled: true, maxRetries: 2 },
  { code: "HTTP_4XX", enabled: false, maxRetries: 1 },
  { code: "ABORTED", enabled: false, maxRetries: 1 }
];
const ruleSchema = Schema.object({
  code: Schema.string().required(),
  enabled: Schema.boolean().default(false),
  maxRetries: Schema.number().step(1).min(0).max(20).default(1)
});
const Config = Schema.object({
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
    continueDelayMs: Schema.number().step(1).min(0).max(6e5).default(5e3),
    maxConsecutive: Schema.number().step(1).min(1).max(50).default(5),
    continueMessage: Schema.string().default("继续"),
    idleWatchdog: Schema.boolean().default(false),
    idleTimeoutMs: Schema.number().step(1).min(3e4).max(6e5).default(18e4),
    // 回合因输出长度截断（max-tokens）时也自动继续；截断同样计入熔断计数
    continueOnMaxTokens: Schema.boolean().default(false)
  }).volatile(),
  // 子智能体（整组 volatile；子智能体失败由主智能体接手，不做自动继续）
  subAgent: Schema.object({
    requestRetry: Schema.boolean().default(true)
  }).volatile(),
  // 补充重试的间隔参数（整组 volatile）
  backoff: Schema.object({
    // exponential：指数退避（initial*2^n，上限 maxDelay）；fixed：每次固定等待 fixedDelay
    intervalMode: Schema.union(["exponential", "fixed"]).default("exponential"),
    initialDelayMs: Schema.number().step(1).min(100).max(6e4).default(1e3),
    maxDelayMs: Schema.number().step(1).min(1e3).max(3e5).default(3e4),
    fixedDelayMs: Schema.number().step(1).min(100).max(6e5).default(5e3)
  }).volatile()
});
const name = "auto-retry";
const inject = ["agents"];
function apply(ctx, config) {
  const log = ctx.logger("auto-retry");
  const agents = ctx.agents;
  const cfg = () => unwrapDeep(config);
  const retryBuckets = /* @__PURE__ */ new Map();
  const continueStreaks = /* @__PURE__ */ new Map();
  const pendingContinues = /* @__PURE__ */ new Map();
  const runningAgents = /* @__PURE__ */ new Map();
  const lifetime = new AbortController();
  let disposed = false;
  const watchdogTimers = /* @__PURE__ */ new Map();
  function isSubagent(agent) {
    return agent?.session?.header?.origin === "subagent";
  }
  function buildUserMessage(text) {
    return {
      id: randomUUID(),
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" }
    };
  }
  function cancellableDelay(ms, ...signals) {
    return new Promise((resolve) => {
      if (signals.some((signal) => signal.aborted)) return resolve(false);
      const timer = setTimeout(() => {
        cleanup();
        resolve(true);
      }, ms);
      const onAbort = () => {
        cleanup();
        resolve(false);
      };
      function cleanup() {
        clearTimeout(timer);
        for (const signal of signals) signal.removeEventListener("abort", onAbort);
      }
      for (const signal of signals) signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  function cancelPendingContinue(sessionId) {
    const timer = pendingContinues.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    pendingContinues.delete(sessionId);
    if (!disposed) notifyOnly({ ts: Date.now(), kind: "continue-cancelled", sessionId });
  }
  function cancelPendingContinueOnUserMessage(sessionId, event) {
    if (event.type !== "agent/inbox/spliced" || !Array.isArray(event.data?.inserted)) return;
    if (event.data.inserted.some((message) => message?.source?.kind === "user")) {
      cancelPendingContinue(sessionId);
    }
  }
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  const statsPath = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "auto-retry-stats.json");
  const STATS_MAX_EVENTS = 5e3;
  const statEvents = [];
  let statsDirty = false;
  let statsRevision = 0;
  let statsFlushPromise = Promise.resolve();
  let statsFlushTimer;
  try {
    if (existsSync(statsPath)) {
      const parsed = JSON.parse(readFileSync(statsPath, "utf8"));
      if (Array.isArray(parsed?.events)) {
        const validEvents = parsed.events.filter((event) => {
          if (!event || typeof event !== "object") return false;
          const item = event;
          return typeof item.ts === "number" && Number.isFinite(item.ts) && typeof item.sessionId === "string" && ["retry", "continue", "watchdog", "turn-end"].includes(String(item.kind));
        });
        statEvents.push(...validEvents.slice(-STATS_MAX_EVENTS));
      }
    }
  } catch (error) {
    log.warn("统计文件加载失败（忽略，从空开始）：%s", error instanceof Error ? error.message : String(error));
  }
  function scheduleStatsFlush() {
    if (disposed) return;
    if (statsFlushTimer) clearTimeout(statsFlushTimer);
    statsFlushTimer = setTimeout(() => {
      void flushStats();
    }, 5e3);
  }
  function recordStat(event) {
    statEvents.push(event);
    if (statEvents.length > STATS_MAX_EVENTS) statEvents.splice(0, statEvents.length - STATS_MAX_EVENTS);
    statsDirty = true;
    statsRevision += 1;
    scheduleStatsFlush();
    const conf = cfg();
    if (conf.enabled && conf.notify) broadcastSSE(event);
  }
  function notifyOnly(event) {
    const conf = cfg();
    if (conf.enabled && conf.notify) broadcastSSE(event);
  }
  const sseClients = /* @__PURE__ */ new Set();
  function broadcastSSE(event) {
    if (sseClients.size === 0) return;
    const frame = `data: ${JSON.stringify(event)}

`;
    for (const res of [...sseClients]) {
      try {
        res.write(frame);
      } catch {
        sseClients.delete(res);
      }
    }
  }
  async function flushStats() {
    statsFlushTimer = void 0;
    const pending = statsFlushPromise.then(async () => {
      if (!statsDirty) return;
      const revision = statsRevision;
      const snapshot = JSON.stringify({ version: 1, events: statEvents });
      const temporaryPath = `${statsPath}.${process.pid}.${revision}.tmp`;
      try {
        await mkdir(dirname(statsPath), { recursive: true });
        await writeFile(temporaryPath, snapshot, "utf8");
        await rename(temporaryPath, statsPath);
        if (statsRevision === revision) statsDirty = false;
      } catch (error) {
        statsDirty = true;
        log.warn("统计文件写入失败：%s", error instanceof Error ? error.message : String(error));
      } finally {
        try {
          await unlink(temporaryPath);
        } catch {
        }
      }
    });
    statsFlushPromise = pending;
    await pending;
    if (statsDirty && !disposed && !statsFlushTimer) scheduleStatsFlush();
  }
  function filterEventsByDays(days) {
    if (!Number.isFinite(days) || days <= 0) return statEvents;
    const since = Date.now() - days * 864e5;
    return statEvents.filter((event) => event.ts >= since);
  }
  const sessionModels = /* @__PURE__ */ new Map();
  ctx.on("agent/request-error", async (payload, next) => {
    let delegated = false;
    let abandoned = false;
    let delegatedPromise;
    const delegate = () => {
      delegated = true;
      return delegatedPromise ??= Promise.resolve().then(next);
    };
    let bucket;
    let bucketRule;
    let used = 0;
    let retryCommitted = false;
    try {
      const conf = cfg();
      if (!conf.enabled) return delegate();
      if (payload.signal.aborted || lifetime.signal.aborted) return delegate();
      const failure = payload.failure ?? {};
      const code = failure.code ?? "UNKNOWN";
      const rule = matchRule(conf.rules, code);
      if (!rule || !rule.enabled || rule.maxRetries <= 0) return delegate();
      const sub = isSubagent(payload.agent);
      const scopeOn = sub ? conf.subAgent.requestRetry : conf.mainAgent.requestRetry;
      if (!scopeOn) return delegate();
      const sessionId = payload.agent.session.id;
      const turns = retryBuckets.get(sessionId) ?? /* @__PURE__ */ new Map();
      retryBuckets.set(sessionId, turns);
      bucket = turns.get(payload.turn) ?? /* @__PURE__ */ new Map();
      turns.set(payload.turn, bucket);
      bucketRule = rule.code;
      used = bucket.get(rule.code) ?? 0;
      if (used >= rule.maxRetries) {
        log.info("补充重试预算已用尽（%s 第 %d 次），放行终局", code, used);
        return delegate();
      }
      bucket.set(rule.code, used + 1);
      const backoff = conf.backoff;
      const base = failure.providerRetryAfterMs != null && Number.isFinite(failure.providerRetryAfterMs) ? clamp(failure.providerRetryAfterMs, 100, backoff.maxDelayMs) : backoff.intervalMode === "fixed" ? backoff.fixedDelayMs : Math.min(backoff.initialDelayMs * 2 ** used, backoff.maxDelayMs);
      const delayMs = Math.round(base * (0.9 + Math.random() * 0.2));
      const retryId = `auto-${sessionId.slice(0, 8)}-${payload.turn}-${payload.step}-${code}-${used + 1}`;
      payload.agent.session.append("llm/retry", {
        retryId,
        turn: payload.turn,
        step: payload.step,
        provider: payload.provider,
        mode: "normal",
        policyKey: "auto-retry",
        retry: used + 1,
        maxRetries: rule.maxRetries,
        delayMs,
        failure
      });
      log.info("计划补充重试：%s（%d/%d），%d ms 后重发", code, used + 1, rule.maxRetries, delayMs);
      if (!await cancellableDelay(delayMs, payload.signal, lifetime.signal)) {
        abandoned = true;
        return void 0;
      }
      payload.agent.session.append("llm/retry-started", {
        retryId,
        turn: payload.turn,
        step: payload.step,
        retry: used + 1
      });
      retryCommitted = true;
      return { kind: "retry" };
    } catch (error) {
      if (delegated) throw error;
      if (!retryCommitted && bucket && bucketRule !== void 0) bucket.set(bucketRule, used);
      if (abandoned) return void 0;
      log.warn("补充重试监听器异常：%o", error);
      return delegate();
    }
  });
  function matchRule(rules, code) {
    for (const rule of rules) {
      if (!rule?.code) continue;
      if (rule.code === code) return rule;
      if (rule.code === "HTTP_4XX" && code.startsWith("HTTP_")) return rule;
    }
    return void 0;
  }
  ctx.on("session/event", (session, event) => {
    cancelPendingContinueOnUserMessage(session.id, event);
    if (watchdogTimers.has(session.id)) armWatchdog(session.id);
    if (event?.type === "assistant/message") {
      const source = event.data?.message?.source;
      if (source?.provider || source?.model) {
        sessionModels.set(session.id, { provider: source.provider, model: source.model });
      }
      return;
    }
    if (event?.type === "llm/retry") {
      const data = event.data ?? {};
      const knownModel2 = sessionModels.get(session.id);
      recordStat({
        ts: Date.now(),
        kind: "retry",
        sessionId: session.id,
        turn: data.turn,
        provider: data.provider ?? knownModel2?.provider,
        model: knownModel2?.model,
        code: data.failure?.code,
        attempt: data.retry,
        maxRetries: data.maxRetries,
        delayMs: data.delayMs,
        source: data.policyKey === "auto-retry" ? "supplemental" : "built-in"
      });
      return;
    }
    if (event?.type !== "turn/end") return;
    const reason = event.data?.reason ?? {};
    const sessionId = session.id;
    const turn = event.data?.turn;
    if (typeof turn === "number") clearRetryBucketsOfTurn(sessionId, turn);
    const knownModel = sessionModels.get(sessionId);
    recordStat({
      ts: Date.now(),
      kind: "turn-end",
      sessionId,
      turn: event.data?.turn,
      provider: knownModel?.provider,
      model: knownModel?.model,
      code: reason.kind === "error" ? reason.error?.code : reason.kind === "aborted" ? "ABORTED" : void 0,
      outcome: reason.kind ?? "unknown"
    });
    if (reason.kind === "completed") {
      continueStreaks.set(sessionId, 0);
      return;
    }
    if (reason.kind === "error") {
      scheduleContinue(sessionId, reason.error?.code, event.data?.turn);
      return;
    }
    if (reason.kind === "max-tokens") {
      if (cfg().mainAgent.continueOnMaxTokens) scheduleContinue(sessionId, "MAX_TOKENS", event.data?.turn);
      return;
    }
    if (reason.kind === "aborted") {
      if (reason.reason?.kind === "hook" && cfg().mainAgent.idleWatchdog) {
        scheduleContinue(sessionId, "ABORTED", event.data?.turn);
      }
      return;
    }
  });
  function clearRetryBucketsOfTurn(sessionId, turn) {
    const turns = retryBuckets.get(sessionId);
    turns?.delete(turn);
    if (turns?.size === 0) retryBuckets.delete(sessionId);
  }
  function clearRetryBucketsOfSession(sessionId) {
    retryBuckets.delete(sessionId);
  }
  function scheduleContinue(sessionId, errorCode, turn) {
    const agent = agents.get(sessionId);
    if (!agent || isSubagent(agent)) return;
    const conf = cfg();
    if (!conf.enabled || !conf.mainAgent.autoContinue) return;
    const streak = continueStreaks.get(sessionId) ?? 0;
    const maxConsecutive = conf.mainAgent.maxConsecutive;
    if (streak >= maxConsecutive) {
      log.warn("会话 %s 已连续失败 %d 次（上限 %d），停止自动继续", sessionId.slice(0, 8), streak, maxConsecutive);
      notifyOnly({ ts: Date.now(), kind: "fuse-stopped", sessionId, code: errorCode, streak, maxConsecutive });
      return;
    }
    if (pendingContinues.has(sessionId)) return;
    const delayMs = conf.mainAgent.continueDelayMs;
    const timer = setTimeout(async () => {
      pendingContinues.delete(sessionId);
      try {
        const live = agents.get(sessionId);
        if (!live || live !== agent) return;
        const now = cfg();
        if (!now.enabled || !now.mainAgent.autoContinue) return;
        if (live.status !== "idle") {
          log.info("会话 %s 延迟期间已有新活动，跳过自动继续", sessionId.slice(0, 8));
          return;
        }
        const nextStreak = (continueStreaks.get(sessionId) ?? 0) + 1;
        continueStreaks.set(sessionId, nextStreak);
        const message = buildUserMessage(now.mainAgent.continueMessage);
        live.followup(message);
        recordStat({
          ts: Date.now(),
          kind: "continue",
          sessionId,
          turn,
          code: errorCode,
          source: "supplemental",
          outcome: `streak=${nextStreak}`
        });
        log.info("会话 %s 回合失败（%s），已自动发送继续（连续第 %d 次）", sessionId.slice(0, 8), errorCode ?? "unknown", nextStreak);
      } catch (error) {
        log.warn("自动继续发送失败：%o", error);
      }
    }, delayMs);
    pendingContinues.set(sessionId, timer);
    notifyOnly({ ts: Date.now(), kind: "continue-scheduled", sessionId, turn, code: errorCode, delayMs });
  }
  ctx.on("agent/inbox/inserted", (payload) => {
    if (payload.message?.source?.kind === "user") cancelPendingContinue(payload.agent.id);
  });
  function trackRunningAgent(agent) {
    if (isSubagent(agent) || agent.status !== "running") return;
    runningAgents.set(agent.id, agent);
    const conf = cfg();
    if (conf.enabled && conf.mainAgent.idleWatchdog) armWatchdog(agent.id);
  }
  for (const agent of agents.list()) trackRunningAgent(agent);
  ctx.on("agent/created", (payload) => {
    trackRunningAgent(payload.agent);
  });
  ctx.on("agent/status", (payload) => {
    const agent = payload.agent;
    if (payload.status === "idle") {
      runningAgents.delete(agent.id);
      disarmWatchdog(agent.id);
      return;
    }
    if (isSubagent(agent)) return;
    runningAgents.set(agent.id, agent);
    const conf = cfg();
    if (!conf.enabled || !conf.mainAgent.idleWatchdog) return;
    armWatchdog(agent.id);
  });
  ctx.on("agent/assistant-stream", (payload) => {
    if (watchdogTimers.has(payload.agent.id)) armWatchdog(payload.agent.id);
  });
  function armWatchdog(sessionId) {
    disarmWatchdog(sessionId);
    const timeoutMs = cfg().mainAgent.idleTimeoutMs;
    const timer = setTimeout(() => {
      watchdogTimers.delete(sessionId);
      const agent = agents.get(sessionId);
      if (!agent || agent.status !== "running") return;
      log.warn("会话 %s 超过 %d ms 无任何活动，主动取消当前请求以触发恢复", sessionId.slice(0, 8), timeoutMs);
      recordStat({ ts: Date.now(), kind: "watchdog", sessionId, code: "IDLE_TIMEOUT", source: "supplemental", outcome: `idle>${timeoutMs}ms` });
      agent.cancel({ kind: "hook", reason: "auto-retry: idle watchdog" }, { keepInbox: true });
    }, timeoutMs);
    watchdogTimers.set(sessionId, { timer, timeoutMs });
  }
  function disarmWatchdog(sessionId) {
    const watchdog = watchdogTimers.get(sessionId);
    if (watchdog) {
      clearTimeout(watchdog.timer);
      watchdogTimers.delete(sessionId);
    }
  }
  ctx.on("loader/volatile-update", () => {
    const conf = cfg();
    for (const [sessionId, agent] of runningAgents) {
      if (agent.status !== "running") {
        runningAgents.delete(sessionId);
        disarmWatchdog(sessionId);
      } else if (conf.enabled && conf.mainAgent.idleWatchdog) {
        if (watchdogTimers.get(sessionId)?.timeoutMs !== conf.mainAgent.idleTimeoutMs) armWatchdog(sessionId);
      } else {
        disarmWatchdog(sessionId);
      }
    }
    if (!conf.enabled || !conf.mainAgent.autoContinue) {
      for (const sessionId of [...pendingContinues.keys()]) cancelPendingContinue(sessionId);
    }
  });
  ctx.on("agent/disposed", (payload) => {
    const sessionId = payload.agent?.id;
    if (!sessionId) return;
    runningAgents.delete(sessionId);
    disarmWatchdog(sessionId);
    cancelPendingContinue(sessionId);
    continueStreaks.delete(sessionId);
    sessionModels.delete(sessionId);
    clearRetryBucketsOfSession(sessionId);
  });
  function buildStatsReport(days) {
    const events = filterEventsByDays(days);
    const retries = events.filter((e) => e.kind === "retry");
    const continues = events.filter((e) => e.kind === "continue");
    const watchdogs = events.filter((e) => e.kind === "watchdog");
    const turnEnds = events.filter((e) => e.kind === "turn-end");
    const turns = /* @__PURE__ */ new Map();
    for (const e of retries) {
      const key = `${e.sessionId}:${e.turn}`;
      const entry = turns.get(key) ?? { retries: 0 };
      entry.retries += 1;
      turns.set(key, entry);
    }
    for (const e of turnEnds) {
      const key = `${e.sessionId}:${e.turn}`;
      const entry = turns.get(key) ?? { retries: 0 };
      entry.outcome = e.outcome;
      turns.set(key, entry);
    }
    const completed = [...turns.values()].filter((t) => t.outcome === "completed" && t.retries > 0);
    const failed = [...turns.values()].filter((t) => t.outcome === "error");
    const tally = (items) => {
      const map = /* @__PURE__ */ new Map();
      for (const item of items) {
        if (!item) continue;
        map.set(item, (map.get(item) ?? 0) + 1);
      }
      return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };
    const byDay = /* @__PURE__ */ new Map();
    const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
    for (const e of retries) {
      const day = dayOf(e.ts);
      const entry = byDay.get(day) ?? { retries: 0, continues: 0, failedTurns: 0 };
      entry.retries += 1;
      byDay.set(day, entry);
    }
    for (const e of continues) {
      const day = dayOf(e.ts);
      const entry = byDay.get(day) ?? { retries: 0, continues: 0, failedTurns: 0 };
      entry.continues += 1;
      byDay.set(day, entry);
    }
    for (const e of turnEnds) {
      if (e.outcome === "error") {
        const day = dayOf(e.ts);
        const entry = byDay.get(day) ?? { retries: 0, continues: 0, failedTurns: 0 };
        entry.failedTurns += 1;
        byDay.set(day, entry);
      }
    }
    return {
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      range: days,
      summary: {
        totalRetries: retries.length,
        builtInRetries: retries.filter((e) => e.source === "built-in").length,
        supplementalRetries: retries.filter((e) => e.source === "supplemental").length,
        autoContinues: continues.length,
        watchdogTriggers: watchdogs.length,
        successTurnsWithRetries: completed.length,
        failedTurns: failed.length,
        avgRetriesPerSuccessTurn: completed.length ? Math.round(completed.reduce((sum, t) => sum + t.retries, 0) / completed.length * 10) / 10 : 0
      },
      byCode: tally(retries.map((e) => e.code)),
      bySource: tally(retries.map((e) => e.source)),
      byProvider: tally(retries.map((e) => e.model ? `${e.provider ?? "?"}/${e.model}` : e.provider)),
      byDay: [...byDay.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, v]) => ({ date, ...v })),
      events: events.slice(-200).reverse()
    };
  }
  ctx.inject(["webServer"], (scope) => {
    const sendJson = (res, status, body) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };
    const disposeStats = scope.webServer.register({
      kind: "prefix",
      path: "/auto-retry",
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          if (url.pathname === "/auto-retry/api/stats") {
            const days = Number(url.searchParams.get("days") ?? "7");
            sendJson(res, 200, buildStatsReport(Number.isFinite(days) ? days : 7));
            return;
          }
          sendJson(res, 404, { error: "not-found" });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    });
    ctx.effect(() => disposeStats, "auto-retry: stats api route");
    const disposeEvents = scope.webServer.register({
      kind: "exact",
      path: "/auto-retry/api/events",
      handler: (req, res) => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        res.write(": connected\n\n");
        sseClients.add(res);
        res.on?.("close", () => {
          sseClients.delete(res);
        });
      }
    });
    ctx.effect(() => disposeEvents, "auto-retry: sse events route");
    log.info("看板 API 与实时通知 SSE 已注册：/auto-retry/api/stats、/auto-retry/api/events");
  });
  ctx.effect(() => {
    return async () => {
      disposed = true;
      lifetime.abort(new Error("auto-retry plugin disposed"));
      for (const watchdog of watchdogTimers.values()) clearTimeout(watchdog.timer);
      watchdogTimers.clear();
      runningAgents.clear();
      for (const sessionId of [...pendingContinues.keys()]) cancelPendingContinue(sessionId);
      pendingContinues.clear();
      retryBuckets.clear();
      continueStreaks.clear();
      if (statsFlushTimer) clearTimeout(statsFlushTimer);
      statsFlushTimer = void 0;
      for (const res of [...sseClients]) {
        try {
          res.end();
        } catch {
        }
      }
      sseClients.clear();
      if (statsDirty) await flushStats();
      else await statsFlushPromise;
    };
  }, "auto-retry: dispose timers and state");
  log.info(
    "自动重试插件已加载（补充重试 %d 条规则，自动继续 %s，看门狗 %s）",
    cfg().rules.filter((r) => r.enabled).length,
    cfg().mainAgent.autoContinue ? "开" : "关",
    cfg().mainAgent.idleWatchdog ? "开" : "关"
  );
}
export {
  Config,
  apply,
  inject,
  name
};
