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
// @description  把 Markdown、本地图片和 Mermaid 图导入八个内容平台的编辑页。不会自动保存或发布。
// @author       RinChan
// @updateURL    https://github.com/rinchan-hoshino/draftferry/releases/latest/download/draftferry.user.js
// @downloadURL  https://github.com/rinchan-hoshino/draftferry/releases/latest/download/draftferry.user.js
// @match        https://zhuanlan.zhihu.com/write*
// @match        https://mp.weixin.qq.com/cgi-bin/appmsg*
// @match        https://my.oschina.net/*/blog/ai-write*
// @match        https://baijiahao.baidu.com/*
// @match        https://mp.toutiao.com/*
// @match        https://mp.sohu.com/*
// @match        https://msp.aliyun.com/*
// @match        https://console.cloud.tencent.com/serviceprovider/products/createNew*
// @grant        unsafeWindow
// @grant        window.onurlchange
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
