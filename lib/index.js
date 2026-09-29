import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFile as writeFileAsync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Schema from "@deepseek-ai/schemastery";
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
  function cancellableDelay(ms, signal) {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
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
        signal.removeEventListener("abort", onAbort);
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  const statsPath = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "auto-retry-stats.json");
  const STATS_MAX_EVENTS = 5e3;
  const statEvents = [];
  let statsDirty = false;
  let statsFlushTimer;
  try {
    if (existsSync(statsPath)) {
      const parsed = JSON.parse(readFileSync(statsPath, "utf8"));
      if (Array.isArray(parsed?.events)) statEvents.push(...parsed.events.slice(-STATS_MAX_EVENTS));
    }
  } catch (error) {
    log.warn("统计文件加载失败（忽略，从空开始）：%s", error instanceof Error ? error.message : String(error));
  }
  function recordStat(event) {
    statEvents.push(event);
    if (statEvents.length > STATS_MAX_EVENTS) statEvents.splice(0, statEvents.length - STATS_MAX_EVENTS);
    statsDirty = true;
    if (statsFlushTimer) clearTimeout(statsFlushTimer);
    statsFlushTimer = setTimeout(() => {
      void flushStats();
    }, 5e3);
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
    if (!statsDirty) return;
    statsDirty = false;
    try {
      await writeFile(statsPath, JSON.stringify({ version: 1, events: statEvents }), "utf8");
    } catch (error) {
      log.warn("统计文件写入失败：%s", error instanceof Error ? error.message : String(error));
    }
  }
  function filterEventsByDays(days) {
    if (!Number.isFinite(days) || days <= 0) return statEvents;
    const since = Date.now() - days * 864e5;
    return statEvents.filter((event) => event.ts >= since);
  }
  const sessionModels = /* @__PURE__ */ new Map();
  ctx.on("agent/request-error", async (payload, next) => {
    try {
      const conf = cfg();
      if (!conf.enabled) return next();
      if (payload.signal.aborted) return next();
      const failure = payload.failure ?? {};
      const code = failure.code ?? "UNKNOWN";
      const rule = matchRule(conf.rules, code);
      if (!rule || !rule.enabled || rule.maxRetries <= 0) return next();
      const sub = isSubagent(payload.agent);
      const scopeOn = sub ? conf.subAgent.requestRetry : conf.mainAgent.requestRetry;
      if (!scopeOn) return next();
      const sessionId = payload.agent.session.id;
      const bucketKey = `${sessionId}:${payload.turn}:${code}`;
      const used = retryBuckets.get(bucketKey) ?? 0;
      if (used >= rule.maxRetries) {
        log.info("补充重试预算已用尽（%s 第 %d 次），放行终局", code, used);
        return next();
      }
      retryBuckets.set(bucketKey, used + 1);
      const backoff = conf.backoff;
      const base = failure.providerRetryAfterMs != null ? clamp(failure.providerRetryAfterMs, 100, backoff.maxDelayMs) : backoff.intervalMode === "fixed" ? backoff.fixedDelayMs : Math.min(backoff.initialDelayMs * 2 ** used, backoff.maxDelayMs);
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
      if (!await cancellableDelay(delayMs, payload.signal)) return void 0;
      payload.agent.session.append("llm/retry-started", {
        retryId,
        turn: payload.turn,
        step: payload.step,
        retry: used + 1
      });
      return { kind: "retry" };
    } catch (error) {
      log.warn("补充重试监听器异常：%o", error);
      return next();
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
    const knownModel = sessionModels.get(sessionId);
    recordStat({
      ts: Date.now(),
      kind: "turn-end",
      sessionId,
      turn: event.data?.turn,
      provider: knownModel?.provider,
      model: knownModel?.model,
      code: reason.kind === "error" ? reason.error?.code : reason.kind === "aborted" ? "ABORTED" : void 0,
      outcome: reason.kind ?? String(reason)
    });
    if (reason.kind === "completed") {
      continueStreaks.set(sessionId, 0);
      clearRetryBucketsOfTurn(sessionId, event.data?.turn);
      return;
    }
    if (reason.kind === "error") {
      clearRetryBucketsOfTurn(sessionId, event.data?.turn);
      scheduleContinue(sessionId, reason.error?.code, event.data?.turn);
      return;
    }
    if (reason.kind === "max-tokens") {
      if (cfg().mainAgent.continueOnMaxTokens) scheduleContinue(sessionId, "MAX_TOKENS", event.data?.turn);
      return;
    }
    if (reason.kind === "aborted") {
      clearRetryBucketsOfTurn(sessionId, event.data?.turn);
      if (reason.reason?.kind === "hook" && cfg().mainAgent.idleWatchdog) {
        scheduleContinue(sessionId, "ABORTED", event.data?.turn);
      }
      return;
    }
  });
  function clearRetryBucketsOfTurn(sessionId, turn) {
    const prefix = `${sessionId}:${turn}:`;
    for (const key of retryBuckets.keys()) {
      if (key.startsWith(prefix)) retryBuckets.delete(key);
    }
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
  }
  ctx.on("agent/status", (payload) => {
    const agent = payload.agent;
    if (payload.status === "idle") {
      disarmWatchdog(agent.id);
      return;
    }
    const conf = cfg();
    if (!conf.enabled || !conf.mainAgent.idleWatchdog) return;
    if (isSubagent(agent)) return;
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
    watchdogTimers.set(sessionId, timer);
  }
  function disarmWatchdog(sessionId) {
    const timer = watchdogTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      watchdogTimers.delete(sessionId);
    }
  }
  ctx.on("loader/volatile-update", () => {
    const conf = cfg();
    if (!conf.enabled || !conf.mainAgent.idleWatchdog) {
      for (const sessionId of [...watchdogTimers.keys()]) disarmWatchdog(sessionId);
    }
    if (!conf.enabled || !conf.mainAgent.autoContinue) {
      for (const timer of pendingContinues.values()) clearTimeout(timer);
      pendingContinues.clear();
    }
  });
  ctx.on("agent/disposed", (payload) => {
    const sessionId = payload.agent?.id;
    if (!sessionId) return;
    disarmWatchdog(sessionId);
    const timer = pendingContinues.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      pendingContinues.delete(sessionId);
    }
    continueStreaks.delete(sessionId);
    sessionModels.delete(sessionId);
    for (const key of retryBuckets.keys()) {
      if (key.startsWith(`${sessionId}:`)) retryBuckets.delete(key);
    }
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
    const failed = [...turns.values()].filter((t) => t.outcome !== void 0 && t.outcome !== "completed" && t.outcome !== "forked");
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
      if (e.outcome && e.outcome !== "completed" && e.outcome !== "forked") {
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
    return () => {
      for (const timer of watchdogTimers.values()) clearTimeout(timer);
      watchdogTimers.clear();
      for (const timer of pendingContinues.values()) clearTimeout(timer);
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
      if (statsDirty) {
        statsDirty = false;
        try {
          writeFileSync(statsPath, JSON.stringify({ version: 1, events: statEvents }), "utf8");
        } catch {
        }
      }
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
