import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [fixtureSource, artifact] = await Promise.all([
  readFile(resolve(root, 'test/browser-fixture.html'), 'utf8'),
  readFile(resolve(root, 'dist/draftferry.user.js'), 'utf8'),
])
const fixture = fixtureSource.replace(
  /<script src="\.\/draftferry\.user\.js"><\/script>/,
  '',
)
const dom = new JSDOM(fixture, {
  url: 'file:///draftferry-smoke/browser-fixture.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
})

dom.window.eval(artifact)
await new Promise((resolve) => dom.window.setTimeout(resolve, 0))

const panel = dom.window.document.querySelector('#rin-draftferry-panel')
assert.ok(panel, '构建产物没有创建排版面板')
assert.equal(
  panel.shadowRoot.querySelector('[data-rin-action="import"]')?.textContent,
  '导入 Markdown',
)
assert.equal(
  panel.shadowRoot.querySelector('[data-rin-action="diagnose"]')?.textContent,
  '下载诊断',
)
assert.equal(panel.getAttribute('aria-label'), '稿渡 · 搜狐号')
assert.equal(panel.shadowRoot.querySelector('.feedback').hidden, true)
assert.equal(panel.shadowRoot.querySelector('details').open, false)
const fileInput = panel.shadowRoot.querySelector('[data-rin-files][multiple]')
assert.ok(fileInput)
assert.equal(fileInput.style.getPropertyValue('display'), 'none')
assert.equal(fileInput.style.getPropertyPriority('display'), 'important')
console.log('verified built userscript UI fixture')
