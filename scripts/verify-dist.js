import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const artifactPath = resolve(root, 'dist/draftferry.user.js')
const [artifact, artifactStat] = await Promise.all([
  readFile(artifactPath, 'utf8'),
  stat(artifactPath),
])

assert.ok(artifact.startsWith('// ==UserScript==\n'), '缺少油猴元数据头')
assert.match(artifact, /\/\/ @name\s+稿渡 · Markdown 一键排版（Preview）/)
assert.match(artifact, /\/\/ @namespace\s+k-neco\.draftferry/)
assert.match(artifact, new RegExp(`// @version\\s+${packageJson.version}`))
assert.match(
  artifact,
  /\/\/ @description\s+为八个平台提供 Markdown 导入和 Mermaid 转图；不会自动保存或发布。/,
)
const canonicalUrl = 'https://acv.k-neco.com/tools/draftferry.user.js'
assert.ok(artifact.includes(`// @updateURL    ${canonicalUrl}`))
assert.ok(artifact.includes(`// @downloadURL  ${canonicalUrl}`))
assert.equal((artifact.match(/^\/\/ @updateURL\s+/gm) ?? []).length, 1)
assert.equal((artifact.match(/^\/\/ @downloadURL\s+/gm) ?? []).length, 1)
const expectedMatches = [
  'https://i.cnblogs.com/posts/edit*',
  'https://editor.csdn.net/md/*',
  'https://zhuanlan.zhihu.com/write*',
  'https://mp.weixin.qq.com/cgi-bin/appmsg*',
  'https://my.oschina.net/*/blog/ai-write*',
  'https://baijiahao.baidu.com/*',
  'https://mp.toutiao.com/*',
  'https://mp.sohu.com/*',
]
for (const match of expectedMatches) {
  assert.ok(artifact.includes(`// @match        ${match}`), `缺少 @match ${match}`)
}
assert.equal((artifact.match(/^\/\/ @match\s+/gm) ?? []).length, expectedMatches.length)
assert.match(artifact, /\/\/ @grant\s+none/)
assert.doesNotMatch(artifact, /\/\/ @require\s+/)
assert.doesNotMatch(artifact, /\/\/ @connect\s+|<all_urls>/)
assert.ok(artifactStat.size < 5 * 1024 * 1024, '构建产物超过 5 MiB')
assert.match(artifact, /Bundled license information/)
const userscriptArtifacts = (await readdir(resolve(root, 'dist')))
  .filter((name) => name.endsWith('.user.js'))
assert.deepEqual(userscriptArtifacts, ['draftferry.user.js'])

console.log(`verified ${artifactPath} (${artifactStat.size} bytes)`)
