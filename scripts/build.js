import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

const metadata = `// ==UserScript==
// @name         Markdown 八平台一键排版（Preview）
// @namespace    rinchan.local
// @version      ${packageJson.version}
// @description  将 Markdown、图片和 Mermaid 流程图安全填入八个内容平台；不会自动保存或发布。
// @author       RinChan
// @match        https://i.cnblogs.com/posts/edit*
// @match        https://editor.csdn.net/md/*
// @match        https://zhuanlan.zhihu.com/write*
// @match        https://mp.weixin.qq.com/cgi-bin/appmsg*
// @match        https://my.oschina.net/*/blog/ai-write*
// @match        https://baijiahao.baidu.com/builder/rc/edit*
// @match        https://mp.toutiao.com/profile_v4/graphic/publish*
// @match        https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==`

await build({
  entryPoints: [resolve(root, 'src/userscript.js')],
  outfile: resolve(root, 'dist/multiplatform-markdown.user.js'),
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
