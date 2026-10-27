#!/usr/bin/env node
// 修复 dsh 会话的 zstd 帧结构：dsh 要求「第一个 frame 恰好只含 header 那一行」，
// 其余 frame 是事件。之前用 `zstd` CLI 把整份文件压成了单帧，导致 dsh 在读取 header 阶段
// 抛 "corrupt Zstandard session log: first frame is not exactly one header line"，
// 会话进不了 persistence.list()，被 workspace 静默过滤（不是 SessionFormatError）。
// 本脚本用与 dsh 相同的 node:zlib(zstdCompress, checksumFlag=1) 重新分帧：帧1=header 行，帧2=全部事件行。
// 用法：node scripts/recompress-session-frames.mjs <session.v4.jsonl.zstd>... [--yes]
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { zstdCompress, zstdDecompress, constants } from 'node:zlib'
import { promisify } from 'node:util'

const zc = promisify(zstdCompress)
const zd = promisify(zstdDecompress)
const OPTS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

const argv = process.argv.slice(2)
const yes = argv.includes('--yes')
const files = argv.filter((a) => !a.startsWith('--'))
if (files.length === 0) { console.error('用法: node scripts/recompress-session-frames.mjs <session.v4.jsonl.zstd>... [--yes]'); process.exit(2) }

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function countFrames(buf) {
  let n = 0, i = 0
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) { n++; i += 4 }
  return n
}

for (const file of files) {
  if (!existsSync(file)) { console.error('  ✗ 不存在:', file); continue }
  const packed = readFileSync(file)
  const beforeFrames = countFrames(packed)
  const plain = (await zd(packed)).toString('utf8')
  const nl = plain.indexOf('\n')
  if (nl === -1) { console.error('  ✗ 明文无换行，异常:', file); continue }
  const headerLine = plain.slice(0, nl + 1)      // 含结尾 \n
  const rest = plain.slice(nl + 1)               // 全部事件行（各自以 \n 结尾）

  // 帧1 = header 行；帧2 = 事件行（若为空则不产第二帧）
  const frame1 = await zc(Buffer.from(headerLine, 'utf8'), OPTS)
  const frame2 = rest.length ? await zc(Buffer.from(rest, 'utf8'), OPTS) : Buffer.alloc(0)
  const out = Buffer.concat([frame1, frame2])

  // 自检：帧数≥2、整体解压与原文一致、帧1 单独解压恰好一行
  const check = (await zd(out)).toString('utf8')
  if (check !== plain) { console.error('  ✗ 自检失败：重压后明文与原不一致，放弃:', file); continue }
  const f1only = (await zd(frame1)).toString('utf8')
  if (f1only.indexOf('\n') !== f1only.length - 1 || f1only.length === 0) {
    console.error('  ✗ 自检失败：帧1 不是恰好一行 header，放弃:', file); continue
  }
  const afterFrames = countFrames(out)
  console.log(`  ${file}\n    帧数 ${beforeFrames} -> ${afterFrames}  明文 ${plain.length}B  header行 ${headerLine.length}B  事件 ${rest.length}B`)
  if (!yes) { console.log('    (dry-run，加 --yes 才写回)'); continue }
  renameSync(file, file + '.pre-reframe.bak')
  writeFileSync(file, out)
  console.log(`    已写回，备份 ${file}.pre-reframe.bak`)
}
