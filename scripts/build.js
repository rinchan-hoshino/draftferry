import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

const metadata = `// ==UserScript==
// @name         搜狐号 Markdown 一键排版
// @namespace    rinchan.local
// @version      ${packageJson.version}
// @description  将 Markdown、图片和 Mermaid 流程图转换后填入搜狐号编辑器；不会自动保存或发布。
// @author       RinChan
// @match        https://mp.sohu.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==`

await build({
  entryPoints: [resolve(root, 'src/userscript.js')],
  outfile: resolve(root, 'dist/sohu-markdown.user.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome138'],
  charset: 'utf8',
  legalComments: 'eof',
  sourcemap: false,
  minify: true,
  banner: { js: metadata },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
})
