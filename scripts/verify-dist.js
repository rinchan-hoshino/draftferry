import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const artifactPath = resolve(root, 'dist/sohu-markdown.user.js')
const [artifact, artifactStat] = await Promise.all([
  readFile(artifactPath, 'utf8'),
  stat(artifactPath),
])

assert.ok(artifact.startsWith('// ==UserScript==\n'), '缺少油猴元数据头')
assert.match(artifact, new RegExp(`// @version\\s+${packageJson.version}`))
assert.match(artifact, /\/\/ @match\s+https:\/\/mp\.sohu\.com\/\*/)
assert.match(artifact, /\/\/ @grant\s+none/)
assert.doesNotMatch(artifact, /\/\/ @require\s+/)
assert.ok(artifactStat.size < 5 * 1024 * 1024, '构建产物超过 5 MiB')
assert.match(artifact, /Bundled license information/)

console.log(`verified ${artifactPath} (${artifactStat.size} bytes)`)
