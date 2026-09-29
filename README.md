# dsh-auto-retry

DeepSeek Harness（dsh）的**自动重试**插件：网络差、报错、中断、无响应时自动恢复会话，实时通知，数据看板还原每一次重试。

> **兼容版本**：dsh `0.1.7-alpha.1` 与 `0.2.0-rc.1`（已通过 0.2.0-rc.1 的插件兼容性校验，含 peer 版本声明）
> **作者**：zxmqq1234 · [GitHub 仓库](https://github.com/zxmqq1234/dsh-auto-retry)

## 能力总览

| 层 | 触发 | 动作 | 默认 |
|---|---|---|---|
| 请求级补充重试 | 模型请求失败（按"触发情况清单"勾选的错误码） | 在内置重试之后按每码配置的次数追加重试（指数退避或固定间隔，尊重 429 Retry-After） | 开；主/子智能体分别开关 |
| 回合级自动继续 | 回合终局失败（重试穷尽、无可用模型等） | 延迟 N 秒自动向会话发送"继续"，带连续失败熔断 | 开；仅主智能体 |
| 截断自动继续 | 输出因 max-tokens 被截断 | 自动发继续接着写（计入熔断） | 关 |
| 无响应看门狗 | 回合运行中超过 N 秒无任何流输出/事件 | 主动取消当前请求 → 走自动继续恢复 | 关 |
| 实时通知 | 每次重试/继续/看门狗触发 | 右上角弹窗（SSE 实时推送） | 开 |
| 数据看板 | 设置页点击加载 | 总重试（内置/补充分计）、自动继续、看门狗、平均重试次数成功、按错误码/按 AI/按日分布、明细 | 不点击不加载 |

安全设计：

- **用户手动停止永不自动继续**（只恢复看门狗自身的 hook 取消与真实报错）。
- **连续失败熔断**：同一会话连续失败达到上限（默认 5 次）停止自动继续，回合成功后清零。
- 重试与继续均写入会话日志（`llm/retry` durable 事件 + "继续"用户消息），可审计。
- 统计持久化于 `<DSH_HOME>/auto-retry-stats.json`（滚动 5000 条），看板数据跨重启保留。

## 设置页

dsh Web UI → 设置 → **自动重试**：总开关、实时通知、触发情况清单（8 种，每项带悬浮说明）、主智能体（补充重试/自动继续/截断继续/看门狗）、子智能体、高级（间隔模式与退避参数）、内置重试策略展示、"为什么有时没重试就停住"说明、数据看板。

## 安装

```sh
# 1. 装进 profile
cd ~/.dsh/profiles/web
dsh plugin add <包名|git 地址|tarball>     # 或 pnpm add file:<插件目录>

# 2. patch 行（dsh plugin add 自动并入；手动安装则手工加）：
# - id: auto-retry
#   name: dsh-auto-retry

# 3. profile package.json 的 dsh.profile.bundles 加入 "dsh-auto-retry"

# 4. 重启 dsh web
```

`pnpm add file:` 是复制安装，重新构建后需重装；开发期建议用 junction（`mklink /J`）。

## 从源码构建

```sh
npm install
npm run build      # 产出 lib/index.js + lib/client.js
```

## License

MIT
