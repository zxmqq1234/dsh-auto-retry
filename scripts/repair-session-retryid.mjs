#!/usr/bin/env node
// 数据修复：把旧版 dsh-auto-retry (v0.3.0) 写坏的 session 日志恢复到加载器不变量。
// 现象：SessionFormatError: llm/retry must keep one retryId per policy chain
// 原因：v0.3.0 的 retryId 掺了 attempt 与错误码后缀，且 retry 跨链连续计数；
//       v0.3.1+ 修复为链内恒定 + 链内从 1 起。
// 做法：只重写 policyKey=='auto-retry' 的 llm/retry 与其配对的 llm/retry-started，
//       dsh 内置重试链（policyKey 以 '[' 开头）原样保留。
// 压缩：必须用 node:zlib 复刻 dsh 的多帧布局——帧1 恰好只含 header 一行，帧2 是全部事件行。
//       用外部 `zstd` CLI 把整份文件压成单帧会让 dsh 连 header 都读不出来，
//       会话会被 workspace 静默过滤（表现为“会话凭空消失”，且没有 SessionFormatError）。
// 用法：node scripts/repair-session-retryid.mjs <session-dir-or-file> [--dry-run] [--yes]
import { readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs'
import { zstdCompress, zstdDecompress, constants } from 'node:zlib'
import { promisify } from 'node:util'
import { dirname, basename, join, resolve } from 'node:path'

const zc = promisify(zstdCompress)
const zd = promisify(zstdDecompress)
// 与 dsh 写入端一致的压缩参数（帧内容校验和）
const ZOPTS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

const argv = process.argv.slice(2)
const dry = argv.includes('--dry-run')
const yes = argv.includes('--yes')
const input = argv.find((a) => !a.startsWith('--'))
if (!input) { console.error('用法: node scripts/repair-session-retryid.mjs <session.v4.jsonl.zstd 或其目录> [--dry-run]'); process.exit(2) }

let dir = input
let file = join(dir, 'session.v4.jsonl.zstd')
if (statSync(input).isFile()) { file = resolve(input); dir = dirname(file) }
if (!existsSync(file)) { console.error('未找到日志:', file); process.exit(2) }

// session id 从目录名取（形如 session-xxxxxxxx-...）
const sid = basename(dir)
const sid16 = sid.slice(0, 16)

let raw
try {
  raw = (await zd(readFileSync(file))).toString('utf8')
} catch (error) {
  console.error('解压失败（文件可能不是合法 zstd）:', error?.message); process.exit(1)
}
const lines = raw.split('\n')
const events = []
const trailing = lines[lines.length - 1] === '' ? '' : lines[lines.length - 1]
for (let i = 0; i < lines.length; i++) {
  if (!lines[i]) continue
  try { events.push({ i, ev: JSON.parse(lines[i]) }) } catch {}
}

// Pass 1: 按链聚合插件写的 llm/retry，规划新 retryId 与新链内 retry。
// key = turn|step|provider|policyKey。原顺序即写入顺序，链内首次出现即 retry=1。
const chainNewId = new Map()
const chainCounter = new Map()
const originalToNew = new Map() // 原 attempt-unique retryId -> { retryId, retry }
for (const { ev } of events) {
  if (ev.type !== 'llm/retry') continue
  const d = ev.data || {}
  if (d.policyKey !== 'auto-retry') continue
  const key = `${d.turn}|${d.step}|${d.provider}|${d.policyKey}`
  if (!chainNewId.has(key)) chainNewId.set(key, `auto-${sid16}-${d.turn}-${d.step}-${d.provider}`)
  const next = (chainCounter.get(key) ?? 0) + 1
  chainCounter.set(key, next)
  if (d.retryId) originalToNew.set(d.retryId, { retryId: chainNewId.get(key), retry: next })
}

// Pass 2: 就地把 llm/retry 与 llm/retry-started 里的 retryId / retry 改掉。
let rewritten = 0
for (const { ev } of events) {
  if (ev.type !== 'llm/retry' && ev.type !== 'llm/retry-started') continue
  const d = ev.data || {}
  const hit = d.retryId && originalToNew.get(d.retryId)
  if (!hit) continue
  d.retryId = hit.retryId
  d.retry = hit.retry
  rewritten++
}

// 校验：每条插件链只有一个 retryId；链内 retry 是 1..N 连续；N <= maxRetries。
const verifyChain = new Map()
for (const { ev } of events) {
  if (ev.type !== 'llm/retry') continue
  const d = ev.data || {}
  if (d.policyKey !== 'auto-retry') continue
  const key = `${d.turn}|${d.step}|${d.provider}|${d.policyKey}`
  const list = verifyChain.get(key) ?? []
  list.push({ retry: d.retry, retryId: d.retryId, maxRetries: d.maxRetries })
  verifyChain.set(key, list)
}
let bad = 0
for (const [k, v] of verifyChain) {
  const ids = new Set(v.map((x) => x.retryId))
  const seq = v.map((x) => x.retry).join(',')
  const want = Array.from({ length: v.length }, (_, i) => i + 1).join(',')
  const over = v.some((x) => x.retry > x.maxRetries)
  if (ids.size !== 1 || seq !== want || over) { bad++; console.error('  仍不合규:', k, { ids: [...ids], seq, want, over }) }
}

console.log(`session=${sid}`)
console.log(`插件链=${verifyChain.size}  重写事件=${rewritten}  修复后违规=${bad}`)
if (bad > 0) { console.error('修复后仍有违规，放弃写回'); process.exit(1) }
if (rewritten === 0) { console.log('未发现待修复事件，无需操作'); process.exit(0) }
if (dry) { console.log('[dry-run] 未写回'); process.exit(0) }
if (!yes) { console.log('追加 --yes 才会真正写回。'); process.exit(3) }

// 备份 + 原子替换：按 dsh 的多帧布局重压，自检通过才落盘
const bak = file + '.pre-repair.bak'
const out = events.map(({ ev }) => JSON.stringify(ev)).join('\n') + (trailing ? '\n' + trailing : '\n')
const nl = out.indexOf('\n')
if (nl === -1) { console.error('明文无换行，异常，放弃写回'); process.exit(1) }
const frame1 = await zc(Buffer.from(out.slice(0, nl + 1), 'utf8'), ZOPTS)
const rest = out.slice(nl + 1)
const frame2 = rest.length ? await zc(Buffer.from(rest, 'utf8'), ZOPTS) : Buffer.alloc(0)
const packed = Buffer.concat([frame1, frame2])
// 自检 1：重压后整体解压必须与目标明文逐字节一致（不丢事件、不改顺序）
if ((await zd(packed)).toString('utf8') !== out) { console.error('自检失败：重压后明文不一致，放弃写回'); process.exit(1) }
// 自检 2：帧1 单独解压必须恰好只有 header 一行，否则 dsh 读不出 header
const f1 = (await zd(frame1)).toString('utf8')
if (f1.length === 0 || f1.indexOf('\n') !== f1.length - 1) { console.error('自检失败：帧1 不是恰好一行 header，放弃写回'); process.exit(1) }
if (existsSync(bak)) renameSync(bak, `${bak}.${Date.now()}.prev`)
renameSync(file, bak)
writeFileSync(file, packed)
console.log(`已修复并写回：${file}`)
console.log(`原文件备份在：${bak}`)
