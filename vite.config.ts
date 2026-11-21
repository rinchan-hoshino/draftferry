/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import monkey from 'vite-plugin-monkey'

const rootDir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8')) as { version: string }
const mermaidPkg = JSON.parse(
  await readFile(resolve(rootDir, 'node_modules/mermaid/package.json'), 'utf8'),
) as { version: string }
const mermaidVersion = mermaidPkg.version
const mermaidSrc = resolve(rootDir, 'node_modules/mermaid/dist/mermaid.min.js')
const mermaidSha256 = createHash('sha256').update(await readFile(mermaidSrc)).digest('hex')

function copyMermaidVendor(): Plugin {
  return {
    name: 'copy-mermaid-vendor',
    async closeBundle() {
      const destDir = resolve(rootDir, 'dist/vendor')
      await mkdir(destDir, { recursive: true })
      await copyFile(mermaidSrc, resolve(destDir, `mermaid-${mermaidVersion}.min.js`))
    },
  }
}

export default defineConfig({
  test: {
    css: true,
  },
  build: {
    minify: true,
  },
  define: {
    __FOLIO_VERSION__: JSON.stringify(pkg.version),
    __MERMAID_VERSION__: JSON.stringify(mermaidVersion),
    __MERMAID_SHA256__: JSON.stringify(mermaidSha256),
  },
  plugins: [
    monkey({
      entry: 'src/userscript.ts',
      userscript: {
        name: {
          '': 'Folio',
          'zh-CN': 'Folio',
        },
        namespace: 'k-neco.folio',
        version: pkg.version,
        description: '把 Markdown、本地图片和 Mermaid 图导入八个内容平台的编辑页。不会自动保存或发布。',
        author: 'RinChan',
        match: [
          'https://zhuanlan.zhihu.com/write*',
          'https://mp.weixin.qq.com/cgi-bin/appmsg*',
          'https://my.oschina.net/*/blog/ai-write*',
          'https://baijiahao.baidu.com/*',
          'https://mp.toutiao.com/*',
          'https://mp.sohu.com/*',
          'https://msp.aliyun.com/*',
          'https://console.cloud.tencent.com/serviceprovider/products/createNew*',
        ],
        grant: ['unsafeWindow', 'window.onurlchange', 'GM_xmlhttpRequest'],
        connect: ['acv.k-neco.com', 'cdn.jsdelivr.net'],
        'run-at': 'document-idle',
        noframes: true,
      },
      build: {
        fileName: 'folio.user.js',
      },
    }),
    copyMermaidVendor(),
  ],
})
