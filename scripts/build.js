import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

const metadata = `// ==UserScript==
// @name         稿渡
// @name:zh-CN   稿渡
// @namespace    k-neco.draftferry
// @version      ${packageJson.version}
// @description  百家号图文编辑页：导入 Markdown、本地图片和 Mermaid 图。不会自动保存或发布。
// @author       RinChan
// @updateURL    https://acv.k-neco.com/tools/draftferry.user.js
// @downloadURL  https://acv.k-neco.com/tools/draftferry.user.js
// @match        https://baijiahao.baidu.com/builder/rc/edit*
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==`

await build({
  entryPoints: [resolve(root, 'src/userscript.js')],
  outfile: resolve(root, 'dist/draftferry.user.js'),
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
    __DRAFTFERRY_VERSION__: JSON.stringify(packageJson.version),
  },
  logLevel: 'info',
})
