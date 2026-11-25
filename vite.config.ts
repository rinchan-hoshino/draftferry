/// <reference types="vitest/config" />
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import monkey from 'vite-plugin-monkey'
import { patchMermaidForTampermonkey } from './src/mermaid-vendor.ts'

const rootDir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8')) as {
  version: string
}
const mermaidPkg = JSON.parse(
  await readFile(resolve(rootDir, 'node_modules/mermaid/package.json'), 'utf8'),
) as { version: string }
const mermaidVersion = mermaidPkg.version
const mermaidSrc = resolve(rootDir, 'node_modules/mermaid/dist/mermaid.min.js')

function buildMermaidVendor(): Plugin {
  return {
    name: 'build-mermaid-vendor',
    async closeBundle() {
      const raw = await readFile(mermaidSrc, 'utf8')
      const patched = patchMermaidForTampermonkey(raw)
      const destDir = resolve(rootDir, 'dist/vendor')
      await mkdir(destDir, { recursive: true })
      await writeFile(resolve(destDir, `mermaid-${mermaidVersion}-tm.min.js`), patched, 'utf8')
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
        description:
          '把 Markdown、本地图片和 Mermaid 图导入八个内容平台的编辑页。不会自动保存或发布。',
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
        require: [`https://acv.k-neco.com/tools/vendor/mermaid-${mermaidVersion}-tm.min.js`],
        updateURL: 'https://acv.k-neco.com/tools/folio.user.js',
        downloadURL: 'https://acv.k-neco.com/tools/folio.user.js',
        grant: ['unsafeWindow', 'window.onurlchange'],
        'run-at': 'document-idle',
        noframes: true,
      },
      build: {
        fileName: 'folio.user.js',
      },
    }),
    buildMermaidVendor(),
  ],
})
