window.__ModuleLoader__.load({ id: "dsh-auto-retry", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
var NS = "auto-retry";
var RULE_DEFINITIONS = [
  { code: "RATE_LIMIT", enabled: true, maxRetries: 2 },
  { code: "SERVER", enabled: true, maxRetries: 2 },
  { code: "TIMEOUT", enabled: true, maxRetries: 2 },
  { code: "EMPTY_RESPONSE", enabled: true, maxRetries: 1 },
  { code: "TRANSPORT", enabled: true, maxRetries: 3 },
  { code: "UNKNOWN", enabled: true, maxRetries: 2 },
  { code: "HTTP_4XX", enabled: false, maxRetries: 1 },
  { code: "ABORTED", enabled: false, maxRetries: 1 }
];
var DEFAULT_CONFIG = {
  enabled: true,
  notify: true,
  rules: RULE_DEFINITIONS.map((rule) => ({ ...rule })),
  mainAgent: {
    requestRetry: true,
    autoContinue: true,
    continueDelayMs: 5e3,
    maxConsecutive: 5,
    continueMessage: "继续",
    idleWatchdog: false,
    idleTimeoutMs: 18e4,
    continueOnMaxTokens: false
  },
  subAgent: {
    requestRetry: true
  },
  backoff: {
    intervalMode: "exponential",
    initialDelayMs: 1e3,
    maxDelayMs: 3e4,
    fixedDelayMs: 5e3
  }
};
var ZH = {
  nav: "自动重试",
  intro: "本插件是内置重试的追加层：内置 normal 模式默认重试 5 次后，本插件才开始追加。",
  layerRequest: "请求级补充重试：为内置重试未覆盖或已耗尽的失败追加重试。",
  layerContinue: "回合级自动继续：终局失败后发送继续消息，并用连续失败上限熔断。",
  layerWatchdog: "无响应看门狗：长时间没有流输出或事件时取消请求并自动继续。",
  enabled: "启用自动重试",
  enabledDesc: "开：插件按下方配置自动重试、自动继续并推送通知。关：插件完全停止工作（dsh 内置重试不受影响）。",
  notify: "实时通知",
  notifyDesc: "开：每次重试/继续/看门狗触发，界面右上角实时弹窗。关：静默执行，只在数据看板里留痕。",
  unavailable: "插件未启用或不可写",
  loading: "正在读取配置",
  triggerSection: "触发情况",
  mainAgent: "主智能体",
  subAgent: "子智能体",
  advanced: "高级",
  requestRetry: "请求级补充重试",
  requestRetryDesc: "开：下方勾选的情况在内置重试耗尽或不覆盖时，为主智能体的请求追加重试。关：主智能体只靠内置重试。",
  autoContinue: "回合级自动继续",
  autoContinueDesc: '开：回合彻底失败（重试穷尽、无可用模型等）后延迟 N 秒自动发"继续"开新回合。关：失败后保持停止，等你手动处理。你手动停止的回合永不自动继续。',
  continueDelay: "继续前延迟",
  continueDelayHint: '自动继续前等待的秒数。如填 5：回合失败后等 5 秒才自动发"继续"；这 5 秒内你若发消息，本次自动继续会跳过。',
  maxConsecutive: "连续失败上限",
  maxConsecutiveHint: "连续失败达到上限后停止自动继续（防止网络彻底断开时无限循环），回合成功后清零。如填 5：连败 5 次后暂停，成功一轮即重新计数。",
  continueMessage: "继续消息",
  continueMessageHint: "自动继续时以用户身份发给模型的消息文本。",
  idleWatchdog: "无响应看门狗",
  idleWatchdogDesc: '开：运行中超过判定时长无任何流输出/事件就主动取消并自动继续（治"流挂起卡死"）。关：请求挂起时只能手动停止。注意：长工具调用+模型长静默可能被误取消（会自动恢复，不丢上下文）。',
  idleTimeout: "无响应判定时长",
  idleTimeoutHint: "多少秒无任何活动判定为无响应。如填 120：整整 2 分钟没有任何流输出/事件才取消；内置流空闲超时默认 300 秒，填小于它的值可更快恢复。",
  watchdogHint: "回合运行期间若超过判定时长完全没有流输出/事件，主动取消当前请求并自动继续；注意与上游流空闲超时的关系。",
  subAgentHint: "子智能体是什么：主智能体通过 subagent 工具派生出来的临时 AI 助手，替主智能体执行子任务（如搜索、批处理），它有自己的会话和模型调用。",
  subAgentHint2: '失败时会发生什么：子智能体的请求失败会先走内置重试、再按上方规则追加；彻底失败后主智能体会收到一条错误结果并自行决定下一步（重派或换路），因此不提供"自动继续"。',
  subAgentHint3: '与主智能体的区别：子智能体通常一次性运行完即结束（one-shot），无法继续对话；重试次数与主智能体共用同一套"触发情况"配置。',
  subAgentDesc: "开：子智能体的请求失败也按上方勾选的情况追加重试。关：子智能体只靠内置重试。",
  backoffInitial: "初始退避",
  backoffInitialHint: "指数退避的起点（秒）。如填 2：第 1 次重试等 2 秒、第 2 次等 4 秒、第 3 次等 8 秒……直到上限。",
  backoffMax: "退避上限",
  backoffMaxHint: "指数退避的封顶（秒）。如填 60：无论指数翻到多大，单次等待不超过 60 秒。",
  fixedDelayHint: "每次重试固定等待的秒数。如填 30：每次重试前都等 30 秒；若上游返回 429 的 Retry-After，会优先用它。",
  backoffHint: "指数退避：间隔每次翻倍（初始×2ⁿ，封顶上限）；固定间隔：每次等固定秒数。两者都尊重 429 的 Retry-After 并加±10%抖动。",
  seconds: "秒",
  retries: "次",
  save: "保存",
  discard: "放弃",
  saved: "已保存",
  saveFailed: "保存失败，请重试。",
  "rules.RATE_LIMIT.label": "限流（429）",
  "rules.RATE_LIMIT.hint": "请求过于频繁/配额限流；内置默认已重试 5 次，此处为追加。",
  "rules.SERVER.label": "服务端错误（5xx）",
  "rules.SERVER.hint": "上游 5xx、过载；内置默认已重试，此处为追加。",
  "rules.TIMEOUT.label": "响应超时",
  "rules.TIMEOUT.hint": "连接建立但流空闲超时；内置默认已重试，此处为追加。",
  "rules.EMPTY_RESPONSE.label": "空响应",
  "rules.EMPTY_RESPONSE.hint": "模型正常结束但零内容；内置默认已重试，此处为追加。",
  "rules.TRANSPORT.label": "网络传输错误",
  "rules.TRANSPORT.hint": "连接中断、SSE 断开、DNS 等网络层故障；内置默认已重试，此处为追加。",
  "rules.UNKNOWN.label": "未知错误",
  "rules.UNKNOWN.hint": "无法归类的失败（网络差时常见）；内置默认不重试，此处为首次重试。",
  "rules.HTTP_4XX.label": "其他 HTTP 4xx",
  "rules.HTTP_4XX.hint": "404/408 等未单列的客户端错误（匹配 HTTP_ 前缀）。",
  "rules.ABORTED.label": "请求中断",
  "rules.ABORTED.hint": "含用户手动停止与看门狗取消；勾选后手动停止也会重试，慎选。",
  continueOnMaxTokens: "截断自动继续",
  continueOnMaxTokensHint: "输出因 max-tokens 被截断时自动发继续；连续截断同样计入熔断上限。",
  continueOnMaxTokensDesc: "开：输出因长度被截断时自动发继续接着写。关：截断即停（连续截断计入熔断上限，防止无限续写）。",
  footerVersion: "自动重试 v{version}",
  footerBy: "by zxmqq1234",
  footerGithub: "GitHub",
  toastRetryTitle: "已自动重试",
  toastContinueTitle: "回合失败，已自动继续",
  toastWatchdogTitle: "无响应看门狗",
  toastStreak: "连续第 {n} 次",
  intervalMode: "间隔模式",
  intervalExponential: "指数退避",
  intervalFixed: "固定间隔",
  fixedDelay: "固定间隔",
  explanationTitle: "为什么有时“没重试就直接停住”？",
  explanation1: "内置重试快且不可见：默认 5 次在几秒内跑完（间隔上限仅 10 秒），界面上基本无感知——展开下方“数据看板”可还原每次重试的真相。",
  explanation2: "零重试错误：无可用模型（NO_ADAPTER）、模型配置非法、请求准备失败等根本不走内置重试，直接失败——本插件的“回合级自动继续”会在失败后接住。",
  explanation3: "空响应当成功：模型返回空内容会被记为正常完成，无错误也无重试（目前无法自动区分）。",
  explanation4: "流挂起：回合内请求可能无限挂起（dsh 回合内没有超时保护）——开启“无响应看门狗”是唯一解药。",
  explanation5: "输出截断：max-tokens 结束不算失败、不重试——可开启“截断自动继续”。",
  builtInTitle: "内置重试策略",
  builtInDescription: "以下为各 provider 当前生效的内置重试策略（由内置 llm-retry 插件执行，本插件在其耗尽后追加）：",
  builtInProvider: "provider",
  builtInRetry: "重试",
  builtInBackoff: "退避",
  builtInCodes: "重试码",
  builtInIdleTimeout: "流空闲超时",
  builtInNotFound: "未找到 provider 配置",
  builtInAlways: "always 无限重试",
  builtInNormal: "normal {count} 次",
  builtInDefault: "默认（normal 5 次）",
  builtInAnyFailure: "所有请求错误",
  builtInDefaultTimeout: "默认 300 秒",
  dashboardTitle: "数据看板",
  dashboardToday: "今天",
  dashboard7Days: "近7天",
  dashboard30Days: "近30天",
  dashboardAll: "全部",
  dashboardLoad: "加载统计",
  dashboardRefresh: "刷新",
  dashboardLoading: "加载中…",
  dashboardError: "统计加载失败：{error}",
  dashboardEmpty: "所选范围内暂无数据",
  dashboardTotalRetries: "总重试",
  dashboardBuiltInRetries: "内置重试",
  dashboardSupplementalRetries: "补充重试",
  dashboardContinues: "自动继续",
  dashboardWatchdog: "看门狗触发",
  dashboardSuccessTurns: "含重试的成功回合",
  dashboardFailedTurns: "失败回合",
  dashboardAverage: "平均重试次数成功",
  dashboardByCode: "按错误码",
  dashboardByProvider: "按 AI",
  dashboardByDay: "按日",
  dashboardDetails: "明细",
  dashboardDate: "日期",
  dashboardRetries: "重试",
  dashboardContinue: "继续",
  dashboardFailedTurn: "失败回合",
  dashboardTime: "时间",
  dashboardType: "类型",
  dashboardAi: "AI",
  dashboardCode: "错误码",
  dashboardAttempt: "次数",
  dashboardSource: "来源",
  dashboardDelay: "延迟",
  dashboardRetry: "重试",
  dashboardWatchdogEvent: "看门狗",
  dashboardTurnEnd: "回合",
  dashboardBuiltIn: "内置",
  dashboardSupplemental: "补充",
  dashboardSeconds: "秒",
  tooltipEnabled: "总开关：关闭后本插件完全停止工作（dsh 内置重试不受影响）。",
  "tooltip.RATE_LIMIT": "API 返回 429 限流：短时间请求过多、中转站或官方配额限流。内置默认已重试 5 次（间隔 0.5~10 秒），耗尽后本插件按此处次数继续追加。",
  "tooltip.SERVER": "上游 5xx：DeepSeek 或中转服务过载、宕机、网关错误（502/503/504）。内置默认已重试 5 次，此处为追加。",
  "tooltip.TIMEOUT": "响应超时：连接建立但流长时间无数据（流空闲超时，内置默认 5 分钟）。内置默认已重试 5 次，此处为追加。嫌 5 分钟太久可在 provider 配置里调低 streamIdleTimeoutMs。",
  "tooltip.EMPTY_RESPONSE": "空响应：请求正常结束但模型零内容输出。内置默认已重试 5 次，此处为追加。",
  "tooltip.TRANSPORT": "网络传输错误：连接中断、SSE 断开、DNS 失败等网络层故障——网络差时最常见。内置默认已重试 5 次，此处为追加。",
  "tooltip.UNKNOWN": "未知错误：无法归类的失败（网络差时的奇葩错误多归此类）。注意：内置默认不重试此类，此处是首次重试机会。",
  "tooltip.HTTP_4XX": "其他 HTTP 4xx：404/408 等未单列的客户端错误。内置不重试，此处为首次重试机会。",
  "tooltip.ABORTED": "请求中断：包括手动点停止和看门狗取消。勾选后手动停止也会被重试，一般不建议勾选。",
  tooltipRequestRetry: "勾选的错误码在内置重试耗尽或不覆盖时，为主智能体的请求追加重试。",
  tooltipAutoContinue: "回合彻底失败（重试穷尽、无可用模型、请求准备失败等）后，等待 N 秒自动发送继续消息开启新回合。你手动停止的回合永不自动继续。",
  tooltipContinueDelay: "自动继续前等待的秒数——留时间给你手动介入；延迟期间你若发消息则自动跳过本次继续。",
  tooltipMaxConsecutive: "同一会话连续失败达到此次数后停止自动继续（防止网络彻底断开时无限循环）。回合成功后清零。",
  tooltipContinueMessage: "自动继续时以用户身份发给模型的消息文本。",
  tooltipIdleWatchdog: "回合运行中若超过判定时长完全没有流输出或事件，主动取消当前请求并走自动继续。可修复“流挂起永远卡住”（dsh 回合内无超时保护），但长工具调用期间模型长静默可能被误取消（会自动恢复，不丢上下文）。",
  tooltipIdleTimeout: "多少秒无任何活动判定为无响应。内置流空闲超时默认 5 分钟，想更快恢复可调小（如 120 秒）。",
  tooltipContinueOnMaxTokens: "输出因 max-tokens 被截断时自动发继续。连续截断同样计入熔断上限，防止无限续写。",
  tooltipSubAgentRetry: "子智能体（subagent 工具派生）的请求失败也按规则追加重试。子智能体失败后主智能体会收到错误结果并自行处理，因此不提供自动继续。"
};
var EN = {
  nav: "Auto retry",
  intro: "This plugin is an additive layer on top of built-in retries: it starts after normal mode has used its default 5 retries.",
  layerRequest: "Request-level supplemental retry: adds attempts for failures not covered by, or exhausted by, built-in retry.",
  layerContinue: "Turn-level auto-continue: sends a continuation message after a terminal failure with a consecutive-failure fuse.",
  layerWatchdog: "No-response watchdog: cancels a request with no stream output or event for too long, then auto-continues.",
  enabled: "Enable auto retry",
  unavailable: "Plugin is disabled or read-only",
  loading: "Loading configuration",
  triggerSection: "Trigger cases",
  mainAgent: "Main agent",
  subAgent: "Sub-agent",
  advanced: "Advanced",
  requestRetry: "Supplemental request retry",
  autoContinue: "Turn-level auto-continue",
  continueDelay: "Delay before continuing",
  maxConsecutive: "Consecutive failure limit",
  continueMessage: "Continuation message",
  idleWatchdog: "No-response watchdog",
  idleTimeout: "No-response threshold",
  watchdogHint: "If a running turn has no stream output or event for longer than this threshold, cancel the request and auto-continue; consider the upstream stream idle timeout.",
  backoffInitial: "Initial backoff",
  backoffMax: "Backoff maximum",
  backoffHint: "Exponential backoff doubles each interval (initial ×2ⁿ, capped); fixed interval waits the same amount each time. Both respect 429 Retry-After and add ±10% jitter.",
  seconds: "seconds",
  retries: "retries",
  save: "Save",
  discard: "Discard",
  saved: "Saved",
  saveFailed: "Save failed. Please try again.",
  "rules.RATE_LIMIT.label": "Rate limit (429)",
  "rules.RATE_LIMIT.hint": "Requests too frequent or quota limited; built-in retry already tried 5 times, so this is additive.",
  "rules.SERVER.label": "Server error (5xx)",
  "rules.SERVER.hint": "Upstream 5xx or overload; built-in retry already tried, so this is additive.",
  "rules.TIMEOUT.label": "Response timeout",
  "rules.TIMEOUT.hint": "Connection established but the stream was idle; built-in retry already tried, so this is additive.",
  "rules.EMPTY_RESPONSE.label": "Empty response",
  "rules.EMPTY_RESPONSE.hint": "The model ended normally without content; built-in retry already tried, so this is additive.",
  "rules.TRANSPORT.label": "Transport error",
  "rules.TRANSPORT.hint": "Connection reset, SSE disconnect, DNS, or another network-layer failure; built-in retry already tried, so this is additive.",
  "rules.UNKNOWN.label": "Unknown error",
  "rules.UNKNOWN.hint": "An uncategorized failure, common on unstable networks; built-in retry does not retry this by default, so this is the first retry.",
  "rules.HTTP_4XX.label": "Other HTTP 4xx",
  "rules.HTTP_4XX.hint": "Client errors such as 404/408 not listed separately; matches the HTTP_ prefix.",
  "rules.ABORTED.label": "Request aborted",
  "rules.ABORTED.hint": "Includes manual stops and watchdog cancellation; selecting this also retries manual stops, so use with care.",
  continueOnMaxTokens: "Continue after truncation",
  continueOnMaxTokensHint: "Automatically continue when output is truncated by max-tokens; consecutive truncations count toward the fuse limit.",
  intervalMode: "Interval mode",
  intervalExponential: "Exponential backoff",
  intervalFixed: "Fixed interval",
  fixedDelay: "Fixed interval",
  explanationTitle: "Why does it sometimes stop “without retrying”?",
  explanation1: "Built-in retries are fast and invisible: the default 5 attempts finish within seconds (only 10 seconds maximum delay), so the UI barely changes. Expand “Dashboard” below to reconstruct every retry.",
  explanation2: "Zero-retry errors: no available model (NO_ADAPTER), invalid model configuration, and request preparation failures bypass built-in retry and fail immediately. This plugin’s turn-level auto-continue catches them afterward.",
  explanation3: "Empty responses count as success: a model can finish with no content and no error or retry (there is currently no automatic way to distinguish this).",
  explanation4: "A hung stream: a turn request can hang indefinitely because dsh has no turn-level timeout protection. Enabling the no-response watchdog is the only remedy.",
  explanation5: "Output truncation: max-tokens is a normal ending, not a failure, so it is not retried. Enable “Continue after truncation”.",
  builtInTitle: "Built-in retry strategy",
  builtInDescription: "The currently effective built-in retry strategy for each provider (executed by the built-in llm-retry plugin; this plugin adds retries after it is exhausted):",
  builtInProvider: "Provider",
  builtInRetry: "Retries",
  builtInBackoff: "Backoff",
  builtInCodes: "Retryable codes",
  builtInIdleTimeout: "Stream idle timeout",
  builtInNotFound: "No provider configuration found",
  builtInAlways: "always (unlimited)",
  builtInNormal: "normal ({count} retries)",
  builtInDefault: "Default (normal, 5 retries)",
  builtInAnyFailure: "All request failures",
  builtInDefaultTimeout: "Default (300 seconds)",
  dashboardTitle: "Dashboard",
  dashboardToday: "Today",
  dashboard7Days: "Last 7 days",
  dashboard30Days: "Last 30 days",
  dashboardAll: "All",
  dashboardLoad: "Load statistics",
  dashboardRefresh: "Refresh",
  dashboardLoading: "Loading…",
  dashboardError: "Failed to load statistics: {error}",
  dashboardEmpty: "No data in the selected range",
  dashboardTotalRetries: "Total retries",
  dashboardBuiltInRetries: "Built-in retries",
  dashboardSupplementalRetries: "Supplemental retries",
  dashboardContinues: "Auto-continues",
  dashboardWatchdog: "Watchdog triggers",
  dashboardSuccessTurns: "Successful turns with retries",
  dashboardFailedTurns: "Failed turns",
  dashboardAverage: "Average retries per successful turn",
  dashboardByCode: "By error code",
  dashboardByProvider: "By AI",
  dashboardByDay: "By day",
  dashboardDetails: "Details",
  dashboardDate: "Date",
  dashboardRetries: "Retries",
  dashboardContinue: "Continues",
  dashboardFailedTurn: "Failed turns",
  dashboardTime: "Time",
  dashboardType: "Type",
  dashboardAi: "AI",
  dashboardCode: "Error code",
  dashboardAttempt: "Attempts",
  dashboardSource: "Source",
  dashboardDelay: "Delay",
  dashboardRetry: "Retry",
  dashboardWatchdogEvent: "Watchdog",
  dashboardTurnEnd: "Turn",
  dashboardBuiltIn: "Built-in",
  dashboardSupplemental: "Supplemental",
  dashboardSeconds: "seconds",
  tooltipEnabled: "Global switch: when off, this plugin stops completely (dsh built-in retries are unaffected).",
  "tooltip.RATE_LIMIT": "API returned 429 rate limit: too many requests in a short time, or relay/provider quota limiting. Built-in retry normally tries 5 times (0.5–10 second delays); this plugin adds the configured attempts afterward.",
  "tooltip.SERVER": "Upstream 5xx: DeepSeek or relay overload, outage, or gateway errors (502/503/504). Built-in retry normally tries 5 times; this is additive.",
  "tooltip.TIMEOUT": "Response timeout: the connection exists but the stream has no data for too long (stream idle timeout, 5 minutes by default). Built-in retry normally tries 5 times; this is additive. Lower streamIdleTimeoutMs in provider settings if 5 minutes is too long.",
  "tooltip.EMPTY_RESPONSE": "Empty response: the request ended normally but the model produced no content. Built-in retry normally tries 5 times; this is additive.",
  "tooltip.TRANSPORT": "Network transport error: connection interruption, SSE disconnect, DNS failure, or another network-layer fault—most common on poor networks. Built-in retry normally tries 5 times; this is additive.",
  "tooltip.UNKNOWN": "Unknown error: an uncategorized failure (unstable networks often produce unusual errors here). Built-in retry does not retry this by default; this is the first retry opportunity.",
  "tooltip.HTTP_4XX": "Other HTTP 4xx: client errors such as 404/408 not listed separately. Built-in retry does not retry these; this is the first retry opportunity.",
  "tooltip.ABORTED": "Request aborted: includes manual stop and watchdog cancellation. Selecting this retries manual stops too, which is generally not recommended.",
  tooltipRequestRetry: "Adds request retries for the selected error codes after built-in retry is exhausted or does not cover them.",
  tooltipAutoContinue: "After a turn finally fails (retries exhausted, no model, request preparation failure, etc.), wait N seconds and send a continuation message to start a new turn. Manually stopped turns never auto-continue.",
  tooltipContinueDelay: "Seconds to wait before auto-continuing—leaves time for manual intervention. If you send a message during the delay, this continuation is skipped.",
  tooltipMaxConsecutive: "Stop auto-continuing after this many consecutive failures in one session (prevents an endless loop when the network is down). Reset after a successful turn.",
  tooltipContinueMessage: "The user message text sent to the model for an automatic continuation.",
  tooltipIdleWatchdog: "If a running turn has no stream output or event for longer than the threshold, cancel the request and use auto-continue. It fixes a permanently hung stream (dsh has no turn-level timeout), but long silent tool calls may be cancelled mistakenly (context is recovered automatically).",
  tooltipIdleTimeout: "Seconds without any activity before treating the turn as unresponsive. Built-in stream idle timeout is 5 minutes; lower this (for example, 120 seconds) to recover sooner.",
  tooltipContinueOnMaxTokens: "Automatically continue when output is truncated by max-tokens. Consecutive truncations count toward the fuse limit to prevent endless writing.",
  tooltipSubAgentRetry: "Request failures from sub-agents (derived by subagent tools) also use the supplemental retry rules. The main agent receives the failure result and handles it, so auto-continue is not provided.",
  enabledDesc: "On: the plugin retries, continues and notifies per the configuration below. Off: the plugin is fully inactive (built-in dsh retry is unaffected).",
  notify: "Live notifications",
  notifyDesc: "On: every retry/continue/watchdog event pops up in the top-right corner. Off: silent execution, only recorded in the dashboard.",
  requestRetryDesc: "On: selected failures get supplemental retries for the main agent after built-in retry is exhausted or not applicable. Off: main agent relies on built-in retry only.",
  autoContinueDesc: 'On: after a turn fails for good (retries exhausted, no adapter, ...), wait N seconds and auto-send "continue". Off: the session stays stopped until you act. Manually stopped turns never auto-continue.',
  continueDelayHint: "Seconds to wait before an automatic continuation. E.g. 5: the continuation fires 5s after a failed turn; sending a message during that window skips it.",
  maxConsecutiveHint: "Stop auto-continuing after this many consecutive failures (prevents infinite loops when the network is fully down); a successful turn resets the count. E.g. 5: pause after 5 straight failures.",
  continueMessageHint: "Sent to the model as the user message when auto-continuing.",
  idleWatchdogDesc: "On: if a running turn has no stream output or event for the threshold, cancel it and auto-continue (fixes hung requests). Off: a hung request can only be stopped manually. Note: long tool calls with a silent model may be cancelled (it recovers automatically without losing context).",
  idleTimeoutHint: "Seconds of zero activity before declaring no-response. E.g. 120: cancel only after 2 full minutes of silence; the built-in stream idle timeout defaults to 300s — lower values recover faster.",
  subAgentHint: "What a sub-agent is: a temporary AI assistant derived by the main agent via the subagent tool for subtasks (search, batch work, ...). It has its own session and model calls.",
  subAgentHint2: "On failure: the sub-agent request goes through built-in retry first, then the rules above. If it fails for good, the main agent receives an error result and decides what to do (re-dispatch or reroute), so no auto-continue is needed.",
  subAgentHint3: 'Differences from the main agent: sub-agents usually run once and finish (one-shot) and cannot be continued; retry counts share the same "trigger cases" configuration as the main agent.',
  subAgentDesc: "On: sub-agent request failures also get supplemental retries per the selected cases. Off: sub-agents rely on built-in retry only.",
  continueOnMaxTokensDesc: 'On: when output is truncated by length, auto-send "continue" to keep writing. Off: stop at truncation (consecutive truncations count toward the fuse).',
  backoffInitialHint: "Starting point of exponential backoff (seconds). E.g. 2: retry 1 waits 2s, retry 2 waits 4s, retry 3 waits 8s... up to the cap.",
  backoffMaxHint: "Cap of exponential backoff (seconds). E.g. 60: no single wait exceeds 60 seconds no matter how the exponent grows.",
  fixedDelayHint: "Fixed seconds to wait before each retry. E.g. 30: every retry waits 30s first; a 429 Retry-After from upstream takes precedence.",
  footerVersion: "Auto retry v{version}",
  footerBy: "by zxmqq1234",
  footerGithub: "GitHub",
  toastRetryTitle: "Retried automatically",
  toastContinueTitle: "Turn failed, continued automatically",
  toastWatchdogTitle: "No-response watchdog",
  toastStreak: "streak #{n}"
};
var STYLES = `
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
.dshar-provider-row { display: grid; grid-template-columns: minmax(120px, 1fr) repeat(4, minmax(150px, 1fr)); gap: 10px; padding: 7px 0; border-top: 1px solid var(--dsw-border-subtle, currentColor); font-size: 12px; }
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
`;
function clampNumber(value, min, max, fallback) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}
function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}
function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}
function normalizeConfig(value) {
  const source = value ?? DEFAULT_CONFIG;
  const sourceRules = Array.isArray(source.rules) ? source.rules : [];
  const rules = RULE_DEFINITIONS.map((definition) => {
    const found = sourceRules.find((rule) => rule?.code === definition.code);
    return {
      code: definition.code,
      enabled: typeof found?.enabled === "boolean" ? found.enabled : definition.enabled,
      maxRetries: clampInteger(found?.maxRetries, 0, 20, definition.maxRetries)
    };
  });
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.enabled,
    notify: typeof source.notify === "boolean" ? source.notify : DEFAULT_CONFIG.notify,
    rules,
    mainAgent: {
      requestRetry: typeof source.mainAgent?.requestRetry === "boolean" ? source.mainAgent.requestRetry : DEFAULT_CONFIG.mainAgent.requestRetry,
      autoContinue: typeof source.mainAgent?.autoContinue === "boolean" ? source.mainAgent.autoContinue : DEFAULT_CONFIG.mainAgent.autoContinue,
      continueDelayMs: clampInteger(source.mainAgent?.continueDelayMs, 0, 6e5, DEFAULT_CONFIG.mainAgent.continueDelayMs),
      maxConsecutive: clampInteger(source.mainAgent?.maxConsecutive, 1, 50, DEFAULT_CONFIG.mainAgent.maxConsecutive),
      continueMessage: typeof source.mainAgent?.continueMessage === "string" ? source.mainAgent.continueMessage : DEFAULT_CONFIG.mainAgent.continueMessage,
      idleWatchdog: typeof source.mainAgent?.idleWatchdog === "boolean" ? source.mainAgent.idleWatchdog : DEFAULT_CONFIG.mainAgent.idleWatchdog,
      idleTimeoutMs: clampInteger(source.mainAgent?.idleTimeoutMs, 3e4, 6e5, DEFAULT_CONFIG.mainAgent.idleTimeoutMs),
      continueOnMaxTokens: typeof source.mainAgent?.continueOnMaxTokens === "boolean" ? source.mainAgent.continueOnMaxTokens : DEFAULT_CONFIG.mainAgent.continueOnMaxTokens
    },
    subAgent: {
      requestRetry: typeof source.subAgent?.requestRetry === "boolean" ? source.subAgent.requestRetry : DEFAULT_CONFIG.subAgent.requestRetry
    },
    backoff: {
      intervalMode: source.backoff?.intervalMode === "fixed" ? "fixed" : "exponential",
      initialDelayMs: clampInteger(source.backoff?.initialDelayMs, 100, 6e4, DEFAULT_CONFIG.backoff.initialDelayMs),
      maxDelayMs: clampInteger(source.backoff?.maxDelayMs, 1e3, 3e5, DEFAULT_CONFIG.backoff.maxDelayMs),
      fixedDelayMs: clampInteger(source.backoff?.fixedDelayMs, 100, 6e5, DEFAULT_CONFIG.backoff.fixedDelayMs)
    }
  };
}
function configsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function millisecondsToSeconds(milliseconds) {
  return milliseconds / 1e3;
}
function secondsToMilliseconds(seconds, min, max, fallbackMs) {
  const fallbackSeconds = millisecondsToSeconds(fallbackMs);
  return Math.round(clampNumber(seconds, min, max, fallbackSeconds) * 1e3);
}
function Field({ label, hint, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-field-label", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }),
      hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: hint }) : null
    ] }),
    children
  ] });
}
function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-row-item", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-row-text", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-row-label", children: label }),
      desc ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-row-desc", children: desc }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Switch, { checked, onChange, label, title: desc, disabled })
  ] });
}
function displayInteger(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}
function displayNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function formatMessage(message, values) {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), message);
}
function readProviderStrategies(describe, t) {
  try {
    const snapshot = describe.getSnapshot();
    const namespaces = Array.isArray(snapshot?.view?.namespaces) ? snapshot.view.namespaces : [];
    const rows = [];
    for (const namespace of namespaces) {
      if (!namespace || typeof namespace !== "object") continue;
      const item = namespace;
      if (item.ns !== "llm-pi-ai" && item.ns !== "llm-deepseek") continue;
      if (!item.value || typeof item.value !== "object") continue;
      const providers = item.value.providers;
      if (!providers || typeof providers !== "object" || Array.isArray(providers)) continue;
      for (const [key, rawProvider] of Object.entries(providers)) {
        if (!rawProvider || typeof rawProvider !== "object") continue;
        const provider = rawProvider;
        const policy = provider.retryPolicy;
        const retryText = policy ? policy.mode === "always" ? t("builtInAlways") : formatMessage(t("builtInNormal"), { count: displayInteger(policy.maxRetries, 5) }) : t("builtInDefault");
        const backoff = policy?.backoff;
        const backoffText = backoff ? `${displayInteger(backoff.initialDelayMs, 500) / 1e3}–${displayInteger(backoff.maxDelayMs, 1e4) / 1e3}s / ±${Math.round(displayNumber(backoff.jitterRatio, 0.1) * 100)}%` : "0.5–10s / ±10%";
        const retryableCodes = policy?.mode === "always" ? [t("builtInAnyFailure")] : Array.isArray(policy?.retryableCodes) ? policy.retryableCodes.filter((code) => typeof code === "string") : ["EMPTY_RESPONSE", "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT"];
        const timeout = displayInteger(provider.streamIdleTimeoutMs, 0);
        rows.push({
          name: typeof provider.displayName === "string" && provider.displayName ? provider.displayName : key,
          retryText,
          backoffText,
          codesText: retryableCodes.join(", "),
          timeoutText: timeout > 0 ? `${timeout / 1e3}${t("seconds")}` : t("builtInDefaultTimeout")
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}
function formatEventTime(value) {
  const timestamp = displayNumber(value, 0);
  if (timestamp <= 0) return "—";
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}
function eventKindLabel(kind, t) {
  if (kind === "retry") return t("dashboardRetry");
  if (kind === "continue") return t("dashboardContinue");
  if (kind === "watchdog") return t("dashboardWatchdogEvent");
  if (kind === "turn-end") return t("dashboardTurnEnd");
  return typeof kind === "string" && kind ? kind : "—";
}
function RuleRow({
  rule,
  t,
  disabled,
  onChange
}) {
  const tooltip = t(`tooltip.${rule.code}`);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-rule-row", title: tooltip, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Checkbox,
      {
        checked: rule.enabled,
        onChange: (enabled) => onChange({ enabled }),
        label: t(`rules.${rule.code}.label`),
        title: tooltip,
        disabled
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint dshar-rule-hint", children: t(`rules.${rule.code}.hint`) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Input,
      {
        className: "dshar-number",
        type: "number",
        min: 0,
        max: 20,
        step: 1,
        value: rule.maxRetries,
        title: tooltip,
        "aria-label": `${t(`rules.${rule.code}.label`)} ${t("retries")}`,
        disabled: disabled || !rule.enabled,
        onChange: (event) => onChange({ maxRetries: clampInteger(event.currentTarget.valueAsNumber, 0, 20, rule.maxRetries) })
      }
    )
  ] });
}
function ExplanationCard({ t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dshar-card dshar-details", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { className: "dshar-summary", children: t("explanationTitle") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", { className: "dshar-explanation dshar-hint", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("explanation1") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("explanation2") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("explanation3") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("explanation4") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("explanation5") })
    ] })
  ] });
}
function BuiltInStrategyCard({ t, describe }) {
  const [revision, setRevision] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => describe.subscribe(() => setRevision((current) => current + 1)), [describe]);
  const rows = readProviderStrategies(describe, t);
  void revision;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshar-card-title", children: t("builtInTitle") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-hint", children: t("builtInDescription") }),
    rows.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-provider-list", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-provider-row dshar-muted", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("builtInProvider") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("builtInRetry") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("builtInCodes") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("builtInBackoff") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("builtInIdleTimeout") })
      ] }),
      rows.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-provider-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.name }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.retryText }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.codesText || "—" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.backoffText }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.timeoutText })
      ] }, `${row.name}-${row.retryText}-${row.timeoutText}-${index}`))
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-hint", children: t("builtInNotFound") })
  ] });
}
function DistributionList({
  items,
  t,
  provider
}) {
  return items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dshar-dashboard-list", children: items.map((item, index) => {
    const label = provider ? [item.label ?? item.provider, item.model].filter((value) => typeof value === "string" && value).join(" / ") : item.label ?? item.code ?? item.source;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: typeof label === "string" && label ? label : "—" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: displayInteger(item.count) })
    ] }, `${String(label)}-${index}`);
  }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-hint", children: "—" });
}
function StatsDashboard({ t }) {
  const [range, setRange] = (0, import_react.useState)(7);
  const [loaded, setLoaded] = (0, import_react.useState)(false);
  const [expanded, setExpanded] = (0, import_react.useState)(false);
  const [reloadNonce, setReloadNonce] = (0, import_react.useState)(0);
  const [requestedRange, setRequestedRange] = (0, import_react.useState)(null);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const [stats, setStats] = (0, import_react.useState)(null);
  const requestGeneration = (0, import_react.useRef)(0);
  const loadStats = async (nextRange) => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/auto-retry/api/stats?days=${nextRange}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
      const payload = await response.json();
      if (!payload || typeof payload !== "object") throw new Error("invalid response");
      if (generation === requestGeneration.current) setStats(payload);
    } catch (loadError) {
      if (generation !== requestGeneration.current) return;
      setStats(null);
      setError(formatMessage(t("dashboardError"), { error: loadError instanceof Error ? loadError.message : String(loadError) }));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  };
  (0, import_react.useEffect)(() => {
    if (loaded && expanded && requestedRange === range) void loadStats(range);
  }, [range, loaded, reloadNonce, requestedRange, expanded]);
  (0, import_react.useEffect)(() => {
    if (expanded) return () => {
      requestGeneration.current += 1;
    };
    requestGeneration.current += 1;
  }, [expanded]);
  const summary = stats?.summary;
  const events = Array.isArray(stats?.events) ? stats.events : [];
  const totalRetries = displayInteger(summary?.totalRetries);
  const autoContinues = displayInteger(summary?.autoContinues);
  const watchdogTriggers = displayInteger(summary?.watchdogTriggers);
  const failedTurns = displayInteger(summary?.failedTurns);
  const successfulTurns = displayInteger(summary?.successTurnsWithRetries ?? summary?.successTurns);
  const empty = stats !== null && totalRetries + autoContinues + watchdogTriggers + failedTurns === 0 && successfulTurns === 0 && events.length === 0;
  const byCode = Array.isArray(stats?.byCode) ? stats.byCode : [];
  const byProvider = Array.isArray(stats?.byProvider) ? stats.byProvider : [];
  const byDay = Array.isArray(stats?.byDay) ? stats.byDay : [];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dshar-card dshar-details", onToggle: (event) => setExpanded(event.currentTarget.open), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { className: "dshar-summary", children: t("dashboardTitle") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-dashboard-toolbar", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-dashboard-filters", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_dsh_client_ui_primitives.SegmentedControl,
        {
          id: "auto-retry-dashboard-range",
          label: t("dashboardTitle"),
          value: String(range),
          options: [
            { value: "1", label: t("dashboardToday") },
            { value: "7", label: t("dashboard7Days") },
            { value: "30", label: t("dashboard30Days") },
            { value: "0", label: t("dashboardAll") }
          ],
          onChange: (value) => {
            const nextRange = Number(value);
            setRange(nextRange);
            if (loaded) setRequestedRange(nextRange);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshar-button", type: "button", disabled: loading, onClick: () => {
        if (!loaded) {
          setRequestedRange(range);
          setLoaded(true);
        } else {
          setRequestedRange(range);
          setReloadNonce((current) => current + 1);
        }
      }, children: loaded ? t("dashboardRefresh") : t("dashboardLoad") })
    ] }) }),
    loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-status", role: "status", children: t("dashboardLoading") }) : null,
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-dashboard-error", role: "alert", children: error }) : null,
    stats && !loading ? empty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-hint", children: t("dashboardEmpty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-dashboard-grid", children: [
        [t("dashboardTotalRetries"), totalRetries],
        [t("dashboardBuiltInRetries"), displayInteger(summary?.builtInRetries)],
        [t("dashboardSupplementalRetries"), displayInteger(summary?.supplementalRetries)],
        [t("dashboardContinues"), autoContinues],
        [t("dashboardWatchdog"), watchdogTriggers],
        [t("dashboardSuccessTurns"), successfulTurns],
        [t("dashboardFailedTurns"), displayInteger(summary?.failedTurns)],
        [t("dashboardAverage"), displayNumber(summary?.avgRetriesPerSuccessTurn).toFixed(2)]
      ].map(([label, value]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-dashboard-stat", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-dashboard-stat-value", children: value }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-dashboard-stat-label", children: label })
      ] }, String(label))) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-dashboard-columns", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-dashboard-subcard", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { className: "dshar-dashboard-subtitle", children: t("dashboardByCode") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DistributionList, { items: byCode, t })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-dashboard-subcard", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { className: "dshar-dashboard-subtitle", children: t("dashboardByProvider") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DistributionList, { items: byProvider, t, provider: true })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-dashboard-subcard", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { className: "dshar-dashboard-subtitle", children: t("dashboardByDay") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-dashboard-table-wrap", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "dshar-dashboard-table", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardDate") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardRetries") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardContinue") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardFailedTurn") })
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: byDay.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: typeof item.date === "string" ? item.date : "—" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: displayInteger(item.retries) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: displayInteger(item.continues) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: displayInteger(item.failedTurns) })
          ] }, `${String(item.date)}-${index}`)) })
        ] }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-dashboard-subcard", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { className: "dshar-dashboard-subtitle", children: t("dashboardDetails") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-dashboard-table-wrap", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "dshar-dashboard-table", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardTime") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardType") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardAi") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardCode") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardAttempt") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardSource") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("dashboardDelay") })
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: events.map((event, index) => {
            const attempt = event.attempt == null ? "—" : `${displayInteger(event.attempt)}/${displayInteger(event.maxRetries)}`;
            const delay = event.delayMs == null ? "—" : `${(displayNumber(event.delayMs) / 1e3).toFixed(2)}${t("dashboardSeconds")}`;
            const ai = [event.provider, event.model].filter((value) => typeof value === "string" && value).join(" / ");
            return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: formatEventTime(event.ts) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: eventKindLabel(event.kind, t) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: ai || "—" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: typeof event.code === "string" ? event.code : "—" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: event.kind === "retry" ? attempt : "—" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: event.source === "built-in" ? t("dashboardBuiltIn") : event.source === "supplemental" ? t("dashboardSupplemental") : "—" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: event.kind === "retry" ? delay : "—" })
            ] }, `${String(event.ts)}-${String(event.kind)}-${index}`);
          }) })
        ] }) })
      ] })
    ] }) : null
  ] });
}
var NOTIFY_CODE_LABELS = {
  RATE_LIMIT: "限流(429)",
  SERVER: "服务端错误(5xx)",
  TIMEOUT: "响应超时",
  EMPTY_RESPONSE: "空响应",
  TRANSPORT: "网络传输错误",
  UNKNOWN: "未知错误",
  ABORTED: "请求中断",
  MAX_TOKENS: "输出截断",
  IDLE_TIMEOUT: "无响应"
};
function notifyCodeLabel(code) {
  if (typeof code !== "string" || code === "") return "故障";
  const direct = NOTIFY_CODE_LABELS[code];
  if (direct) return direct;
  if (code.startsWith("HTTP_")) return `HTTP 错误(${code.slice(5)})`;
  return code;
}
function notifyOutcomeText(outcome) {
  if (typeof outcome !== "string") return "";
  const streak = outcome.match(/^streak=(\d+)$/);
  if (streak) return streak[1];
  const idle = outcome.match(/^idle>(\d+)ms$/);
  if (idle) return `${Math.round(Number(idle[1]) / 1e3)} 秒`;
  return "";
}
function toToastItem(event, id, t) {
  const model = typeof event.model === "string" && event.model !== "" ? event.model : "";
  const aiText = model ? `${event.provider ?? ""}/${model}`.replace(/^\//, "") : typeof event.provider === "string" ? event.provider : "";
  const aiSuffix = aiText ? `${aiText} · ` : "";
  if (event.kind === "retry") {
    const attempt = typeof event.attempt === "number" ? event.attempt : "?";
    const maxRetries = typeof event.maxRetries === "number" ? event.maxRetries : "?";
    return { id, title: t("toastRetryTitle"), body: `${aiSuffix}${notifyCodeLabel(event.code)}（${attempt}/${maxRetries}）`, tone: "info" };
  }
  if (event.kind === "continue") {
    const streakText = notifyOutcomeText(event.outcome);
    const streak = streakText ? formatMessage(t("toastStreak"), { n: streakText }) : "";
    return { id, title: t("toastContinueTitle"), body: `${aiSuffix}${notifyCodeLabel(event.code)}${streak ? ` · ${streak}` : ""}`, tone: "info" };
  }
  if (event.kind === "watchdog") {
    const idleText = notifyOutcomeText(event.outcome);
    return { id, title: t("toastWatchdogTitle"), body: `${aiSuffix}${idleText ? `${idleText}无活动，` : ""}已取消请求并准备继续`, tone: "warn" };
  }
  return null;
}
var TOAST_MAX = 3;
var TOAST_HOLD_MS = 4e3;
function NotifyStack({ t, timer }) {
  const [toasts, setToasts] = (0, import_react.useState)([]);
  const counter = (0, import_react.useRef)(0);
  (0, import_react.useEffect)(() => {
    const source = new EventSource("/auto-retry/api/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        const item = toToastItem(event, ++counter.current, t);
        if (!item) return;
        setToasts((current) => {
          const next = [...current, item];
          return next.length > TOAST_MAX ? next.slice(next.length - TOAST_MAX) : next;
        });
        timer.timeout(() => {
          setToasts((current) => current.filter((toast) => toast.id !== item.id));
        }, TOAST_HOLD_MS);
      } catch {
      }
    };
    return () => source.close();
  }, [t, timer]);
  if (toasts.length === 0) return null;
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-toast-stack", children: toasts.map((toast) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: toast.tone === "warn" ? "dshar-toast dshar-toast-warn" : "dshar-toast", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-toast-title", children: toast.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-toast-body", children: toast.body })
    ] }, toast.id)) }),
    document.body
  );
}
function AutoRetrySection({ t, form, describe }) {
  const [snapshot, setSnapshot] = (0, import_react.useState)(() => form.getSnapshot());
  const initialConfig = normalizeConfig(snapshot.value);
  const [draft, setDraft] = (0, import_react.useState)(() => cloneConfig(initialConfig));
  const [baseline, setBaseline] = (0, import_react.useState)(() => cloneConfig(initialConfig));
  const [baselineRevision, setBaselineRevision] = (0, import_react.useState)(snapshot.revision);
  const [hasPendingDraft, setHasPendingDraft] = (0, import_react.useState)(false);
  const [saveState, setSaveState] = (0, import_react.useState)("idle");
  const [saveError, setSaveError] = (0, import_react.useState)("");
  const savedTimer = (0, import_react.useRef)(void 0);
  const dirty = hasPendingDraft && !configsEqual(draft, baseline);
  const disabled = !snapshot.writable || snapshot.status !== "ready" || baselineRevision === void 0;
  (0, import_react.useEffect)(() => {
    setSnapshot(form.getSnapshot());
    return form.subscribe(() => setSnapshot(form.getSnapshot()));
  }, [form]);
  (0, import_react.useEffect)(() => {
    if (dirty) return;
    const next = normalizeConfig(snapshot.value);
    setDraft(cloneConfig(next));
    setBaseline(cloneConfig(next));
    setBaselineRevision(snapshot.revision);
    setHasPendingDraft(false);
  }, [snapshot.value, snapshot.revision, dirty]);
  (0, import_react.useEffect)(() => {
    if (saveState !== "saved") return;
    savedTimer.current = setTimeout(() => setSaveState("idle"), 3e3);
    return () => {
      if (savedTimer.current !== void 0) clearTimeout(savedTimer.current);
    };
  }, [saveState]);
  const updateRule = (code, patch) => {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule) => rule.code === code ? { ...rule, ...patch } : rule)
    }));
    setHasPendingDraft(true);
    setSaveState("idle");
  };
  const saveDraft = async () => {
    if (disabled || !dirty || saveState === "saving") return;
    setSaveState("saving");
    setSaveError("");
    try {
      const ok = await form.mutate([
        { op: "set", path: ["enabled"], value: draft.enabled },
        { op: "set", path: ["notify"], value: draft.notify },
        { op: "set", path: ["rules"], value: draft.rules },
        { op: "set", path: ["mainAgent"], value: draft.mainAgent },
        { op: "set", path: ["subAgent"], value: draft.subAgent },
        { op: "set", path: ["backoff"], value: draft.backoff }
      ], baselineRevision);
      if (!ok) {
        setSaveError("写入被拒绝（revision 冲突或校验失败）");
        setSaveState("failed");
        return;
      }
      const nextSnapshot = form.getSnapshot();
      const next = normalizeConfig(nextSnapshot.value ?? draft);
      setDraft(cloneConfig(next));
      setBaseline(cloneConfig(next));
      setBaselineRevision(nextSnapshot.revision);
      setHasPendingDraft(false);
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("failed");
    }
  };
  const discardDraft = () => {
    const next = normalizeConfig(form.getSnapshot().value);
    const nextSnapshot = form.getSnapshot();
    setDraft(cloneConfig(next));
    setBaseline(cloneConfig(next));
    setBaselineRevision(nextSnapshot.revision);
    setHasPendingDraft(false);
    setSaveState("idle");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dshar-root", "aria-label": t("nav"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-intro", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-intro-title", children: t("nav") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-intro-copy", children: t("intro") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", { className: "dshar-layer-list dshar-intro-copy", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("layerRequest") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("layerContinue") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t("layerWatchdog") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExplanationCard, { t }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BuiltInStrategyCard, { t, describe }),
    !snapshot.writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-unavailable", children: t("unavailable") }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshar-card-title", children: t("nav") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: t("enabled"),
          desc: t("enabledDesc"),
          checked: draft.enabled,
          onChange: (enabled) => {
            setDraft((current) => ({ ...current, enabled }));
            setHasPendingDraft(true);
            setSaveState("idle");
          },
          disabled
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: t("notify"),
          desc: t("notifyDesc"),
          checked: draft.notify,
          onChange: (notify) => {
            setDraft((current) => ({ ...current, notify }));
            setHasPendingDraft(true);
            setSaveState("idle");
          },
          disabled
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshar-card-title", children: t("triggerSection") }),
      draft.rules.map((rule) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RuleRow, { rule, t, disabled, onChange: (patch) => updateRule(rule.code, patch) }, rule.code))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshar-card-title", children: t("mainAgent") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: t("requestRetry"),
          desc: t("requestRetryDesc"),
          checked: draft.mainAgent.requestRetry,
          onChange: (requestRetry) => {
            setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, requestRetry } }));
            setHasPendingDraft(true);
            setSaveState("idle");
          },
          disabled
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: t("autoContinue"),
          desc: t("autoContinueDesc"),
          checked: draft.mainAgent.autoContinue,
          onChange: (autoContinue) => {
            setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, autoContinue } }));
            setHasPendingDraft(true);
            setSaveState("idle");
          },
          disabled
        }
      ),
      draft.mainAgent.autoContinue ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-subfield", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("continueDelay"), hint: t("continueDelayHint"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-unit", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_dsh_client_ui_primitives.Input,
            {
              className: "dshar-number",
              type: "number",
              min: 0,
              max: 600,
              step: 0.1,
              value: millisecondsToSeconds(draft.mainAgent.continueDelayMs),
              "aria-label": t("continueDelay"),
              title: t("tooltipContinueDelay"),
              disabled,
              onChange: (event) => {
                const continueDelayMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 0, 600, draft.mainAgent.continueDelayMs);
                setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, continueDelayMs } }));
                setHasPendingDraft(true);
                setSaveState("idle");
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("seconds") })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("maxConsecutive"), hint: t("maxConsecutiveHint"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Input,
          {
            className: "dshar-number",
            type: "number",
            min: 1,
            max: 50,
            step: 1,
            value: draft.mainAgent.maxConsecutive,
            "aria-label": t("maxConsecutive"),
            title: t("tooltipMaxConsecutive"),
            disabled,
            onChange: (event) => {
              const maxConsecutive = clampInteger(event.currentTarget.valueAsNumber, 1, 50, draft.mainAgent.maxConsecutive);
              setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, maxConsecutive } }));
              setHasPendingDraft(true);
              setSaveState("idle");
            }
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("continueMessage"), hint: t("continueMessageHint"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Input,
          {
            className: "dshar-text",
            type: "text",
            value: draft.mainAgent.continueMessage,
            "aria-label": t("continueMessage"),
            title: t("tooltipContinueMessage"),
            disabled,
            onChange: (event) => {
              const continueMessage = event.currentTarget.value;
              setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, continueMessage } }));
              setHasPendingDraft(true);
              setSaveState("idle");
            }
          }
        ) })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: t("idleWatchdog"),
          desc: t("idleWatchdogDesc"),
          checked: draft.mainAgent.idleWatchdog,
          onChange: (idleWatchdog) => {
            setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, idleWatchdog } }));
            setHasPendingDraft(true);
            setSaveState("idle");
          },
          disabled
        }
      ),
      draft.mainAgent.idleWatchdog ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshar-subfield", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("idleTimeout"), hint: t("idleTimeoutHint"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-unit", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Input,
          {
            className: "dshar-number",
            type: "number",
            min: 30,
            max: 600,
            step: 1,
            value: millisecondsToSeconds(draft.mainAgent.idleTimeoutMs),
            "aria-label": t("idleTimeout"),
            title: t("tooltipIdleTimeout"),
            disabled,
            onChange: (event) => {
              const idleTimeoutMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 30, 600, draft.mainAgent.idleTimeoutMs);
              setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, idleTimeoutMs } }));
              setHasPendingDraft(true);
              setSaveState("idle");
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("seconds") })
      ] }) }) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: t("continueOnMaxTokens"),
          desc: t("continueOnMaxTokensDesc"),
          checked: draft.mainAgent.continueOnMaxTokens,
          onChange: (continueOnMaxTokens) => {
            setDraft((current) => ({ ...current, mainAgent: { ...current.mainAgent, continueOnMaxTokens } }));
            setHasPendingDraft(true);
            setSaveState("idle");
          },
          disabled
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshar-card-title", children: t("subAgent") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: t("requestRetry"),
          desc: t("subAgentDesc"),
          checked: draft.subAgent.requestRetry,
          onChange: (requestRetry) => {
            setDraft((current) => ({ ...current, subAgent: { ...current.subAgent, requestRetry } }));
            setHasPendingDraft(true);
            setSaveState("idle");
          },
          disabled
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-subblock", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("subAgentHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("subAgentHint2") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("subAgentHint3") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dshar-card dshar-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { className: "dshar-summary", children: t("advanced") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-segmented", title: t("backoffHint"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshar-field-label", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("intervalMode") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("backoffHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.SegmentedControl,
          {
            id: "auto-retry-interval-mode",
            label: t("intervalMode"),
            value: draft.backoff.intervalMode,
            options: [
              { value: "exponential", label: t("intervalExponential"), title: t("backoffHint") },
              { value: "fixed", label: t("intervalFixed"), title: t("backoffHint") }
            ],
            disabled,
            onChange: (intervalMode) => {
              setDraft((current) => ({ ...current, backoff: { ...current.backoff, intervalMode } }));
              setHasPendingDraft(true);
              setSaveState("idle");
            }
          }
        )
      ] }),
      draft.backoff.intervalMode === "exponential" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("backoffInitial"), hint: t("backoffInitialHint"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-unit", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_dsh_client_ui_primitives.Input,
            {
              className: "dshar-number",
              type: "number",
              min: 0.1,
              max: 60,
              step: 0.1,
              value: millisecondsToSeconds(draft.backoff.initialDelayMs),
              "aria-label": t("backoffInitial"),
              title: t("backoffHint"),
              disabled,
              onChange: (event) => {
                const initialDelayMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 0.1, 60, draft.backoff.initialDelayMs);
                setDraft((current) => ({ ...current, backoff: { ...current.backoff, initialDelayMs } }));
                setHasPendingDraft(true);
                setSaveState("idle");
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("seconds") })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("backoffMax"), hint: t("backoffMaxHint"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-unit", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_dsh_client_ui_primitives.Input,
            {
              className: "dshar-number",
              type: "number",
              min: 1,
              max: 300,
              step: 0.1,
              value: millisecondsToSeconds(draft.backoff.maxDelayMs),
              "aria-label": t("backoffMax"),
              title: t("backoffHint"),
              disabled,
              onChange: (event) => {
                const maxDelayMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 1, 300, draft.backoff.maxDelayMs);
                setDraft((current) => ({ ...current, backoff: { ...current.backoff, maxDelayMs } }));
                setHasPendingDraft(true);
                setSaveState("idle");
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("seconds") })
        ] }) })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("fixedDelay"), hint: t("fixedDelayHint"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-unit", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Input,
          {
            className: "dshar-number",
            type: "number",
            min: 0.1,
            max: 600,
            step: 0.1,
            value: millisecondsToSeconds(draft.backoff.fixedDelayMs),
            "aria-label": t("fixedDelay"),
            title: t("backoffHint"),
            disabled,
            onChange: (event) => {
              const fixedDelayMs = secondsToMilliseconds(event.currentTarget.valueAsNumber, 0.1, 600, draft.backoff.fixedDelayMs);
              setDraft((current) => ({ ...current, backoff: { ...current.backoff, fixedDelayMs } }));
              setHasPendingDraft(true);
              setSaveState("idle");
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-hint", children: t("seconds") })
      ] }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatsDashboard, { t }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshar-button", type: "button", disabled: disabled || !dirty || saveState === "saving", onClick: saveDraft, children: t("save") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dshar-button", type: "button", disabled: !snapshot.writable || !dirty || saveState === "saving", onClick: discardDraft, children: t("discard") }),
      saveState === "saved" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-status", role: "status", children: t("saved") }) : null,
      saveState === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dshar-status", role: "alert", title: saveError, children: [
        t("saveFailed"),
        saveError ? `（${saveError}）` : ""
      ] }) : null,
      !snapshot.writable && snapshot.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshar-status", children: t("loading") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshar-footer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatMessage(t("footerVersion"), { version: "0.2.0" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "·" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("footerBy") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "·" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: "https://github.com/zxmqq1234/dsh-auto-retry", target: "_blank", rel: "noreferrer", children: t("footerGithub") })
    ] })
  ] });
}
var name = "dsh-auto-retry";
var inject = ["slots", "locale", "configForms", "timer"];
function apply(ctx) {
  const form = ctx.configForms.get("auto-retry");
  const describe = ctx.configForms.describe();
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, "zh", ZH), "auto-retry: locale zh");
  ctx.effect(() => ctx.locale.register(NS, "en", EN), "auto-retry: locale en");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-auto-retry";
    style.textContent = STYLES;
    document.head.appendChild(style);
    return () => style.remove();
  }, "auto-retry: styles");
  const Section = () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AutoRetrySection, { t, form, describe });
  ctx.effect(
    () => ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        {
          name: "settings.section",
          id: "auto-retry",
          order: 50,
          locale: NS,
          label: () => t("nav"),
          inject: () => ({})
        },
        Section
      )
    ),
    "auto-retry: settings section"
  );
  const Notify = () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NotifyStack, { t, timer: ctx.timer });
  ctx.effect(
    () => ctx.slots.inject(
      "shell.overlay",
      () => ctx.slots.register({ name: "shell.overlay", id: "auto-retry-toast", order: 30 }, Notify)
    ),
    "auto-retry: overlay notifications"
  );
}
return module.exports;
} });
