/**
 * dsh-auto-retry 构建脚本
 *
 * 产物两份（均已提交 git，安装方无需构建）：
 *   1. lib/index.js  —— host 半：仅 TS→JS 转译，不打包（import 交给 Node 解析）
 *   2. lib/client.js —— client 半：esbuild 打包成 dsh 浏览器模块格式
 *      （window.__ModuleLoader__.load + CJS 工厂；react 与 dsh-client-* 走模块表 external）
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const libDir = join(root, 'lib')
mkdirSync(libDir, { recursive: true })

// 从 package.json 读取版本号，注入 client 产物（设置页页脚显示）
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const clientDefine = { '__DSHAR_VERSION__': JSON.stringify(version) }

// ---------- host 半：转译，不打包 ----------
await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(libDir, 'index.js'),
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  charset: 'utf8',
  logLevel: 'info',
})

// ---------- client 半：打包为 dsh 浏览器模块 ----------
await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(libDir, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  // 模块表符号面：seed 词 + dsh.client.inject 声明的包，禁止内联
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-slots',
  ],
  define: { 'process.env.NODE_ENV': '"production"', ...clientDefine },
  charset: 'utf8',
  logLevel: 'info',
  banner: {
    js: [
      'window.__ModuleLoader__.load({ id: "dsh-auto-retry", factory: (require) => {',
      'var module = { exports: {} };',
      'var exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: 'return module.exports;\n} });' },
})

console.log(`构建完成（v${version}）：lib/index.js + lib/client.js`)
