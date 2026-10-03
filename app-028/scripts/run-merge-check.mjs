/**
 * 多客户合并拼版引擎的可复现测试入口（node，无需浏览器）：
 *   npm run test:merge
 * 用 esbuild（vite 自带依赖）把 TS 测试打包到临时文件再执行，不污染源码目录。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rmSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const entry = join(here, 'merge-check.ts')
const outfile = join(here, '.merge-check.tmp.cjs')

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent',
})

try {
  await import(outfile)
} finally {
  rmSync(outfile, { force: true })
}
