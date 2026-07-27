import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

const metadata = `// ==UserScript==
// @name         稿渡 · Markdown 一键排版（Preview）
// @namespace    k-neco.draftferry
// @version      ${packageJson.version}
// @description  为八个平台提供 Markdown 导入和 Mermaid 转图；不会自动保存或发布。
// @author       RinChan
// @updateURL    https://acv.k-neco.com/tools/draftferry.user.js
// @downloadURL  https://acv.k-neco.com/tools/draftferry.user.js
// @match        https://zhuanlan.zhihu.com/write*
// @match        https://mp.weixin.qq.com/cgi-bin/appmsg*
// @match        https://my.oschina.net/*/blog/ai-write*
// @match        https://baijiahao.baidu.com/*
// @match        https://mp.toutiao.com/*
// @match        https://mp.sohu.com/*
// @match        https://msp.aliyun.com/msp/commodity/list*
// @match        https://console.cloud.tencent.com/serviceprovider/products/createNew*
// @grant        none
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
  },
  logLevel: 'info',
})
