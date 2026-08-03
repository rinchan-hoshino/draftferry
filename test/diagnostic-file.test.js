import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import {
  buildDiagnosticFile,
  downloadDiagnosticFile,
} from '../src/diagnostic-file.js'
import { collectSafeDomMap } from '../src/safe-dom-map.js'

function createSohuPage() {
  return new JSDOM(`
    <input id="PRIVATE_ACCOUNT_ID" class="PRIVATE_ACCOUNT_CLASS" placeholder="请输入标题" value="PRIVATE TITLE">
    <div class="ql-container PRIVATE_CONTAINER_CLASS">
      <div class="ql-editor" contenteditable="true">PRIVATE BODY</div>
    </div>
  `, { url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?PRIVATE=1' })
}

test('完整诊断文件一次包含原结构诊断和搜狐实例预检且不泄露页面内容', () => {
  const dom = createSohuPage()
  const text = buildDiagnosticFile({
    document: dom.window.document,
    pageWindow: dom.window,
    platformId: 'sohu',
    version: 'test-version',
    generatedAt: '2026-08-03T08:44:50.000Z',
  })
  const result = JSON.parse(text)

  assert.equal(result.fileSchema, 1)
  assert.equal(result.generatedAt, '2026-08-03T08:44:50.000Z')
  assert.equal(result.diagnostics.schema, 3)
  assert.equal(result.diagnostics.draftferryVersion, 'test-version')
  assert.equal(result.diagnostics.platformId, 'sohu')
  assert.equal(result.sohuEditorPreflight.operation, 'sohu-editor-preflight')
  assert.equal(result.sohuEditorPreflight.result, 'slot-missing')
  assert.equal(result.safeDomMap.elementCount > 0, true)
  assert.equal(result.safeDomMap.roots[0].kind, 'document')
  assert.equal(result.safeDomMap.roots[0].elements.some((entry) => entry.tag === 'input'), true)
  assert.equal(text.includes('PRIVATE'), false)
  assert.equal(text.includes('https://mp.sohu.com'), false)
  assert.equal(text.includes('__vue__'), false)
})

test('非搜狐完整诊断文件不运行搜狐实例预检', () => {
  const dom = new JSDOM('<main contenteditable="true"></main>', {
    url: 'https://zhuanlan.zhihu.com/write',
  })
  const text = buildDiagnosticFile({
    document: dom.window.document,
    pageWindow: dom.window,
    platformId: 'zhihu',
    version: 'test-version',
    generatedAt: '2026-08-03T08:44:50.000Z',
  })
  const result = JSON.parse(text)

  assert.equal(result.diagnostics.platformId, 'zhihu')
  assert.equal(Object.hasOwn(result, 'sohuEditorPreflight'), false)
})

test('全页安全结构地图保留父子关系并在预算耗尽时明确截断', () => {
  const dom = new JSDOM('<main><section><div><span></span></div></section></main>')
  const complete = collectSafeDomMap(dom.window.document, { maxElements: 20 })
  const elements = complete.roots[0].elements
  const main = elements.find((entry) => entry.tag === 'main')
  const section = elements.find((entry) => entry.tag === 'section')

  assert.equal(complete.truncated, false)
  assert.equal(section.parentIndex, main.index)
  assert.equal(section.depth, main.depth + 1)

  const limited = collectSafeDomMap(dom.window.document, { maxElements: 3 })
  assert.equal(limited.elementCount, 3)
  assert.equal(limited.truncated, true)
})

test('下载诊断生成固定安全文件名和 text/plain Blob', () => {
  const dom = new JSDOM('<body></body>')
  let createdBlob = null
  let revokedUrl = null
  let clicked = null
  dom.window.Blob = class {
    constructor(parts, options) {
      this.parts = parts
      this.options = options
      createdBlob = this
    }
  }
  dom.window.URL.createObjectURL = () => 'blob:diagnostic'
  dom.window.URL.revokeObjectURL = (url) => { revokedUrl = url }
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    clicked = { href: this.href, download: this.download }
  }

  const filename = downloadDiagnosticFile({
    windowObject: dom.window,
    document: dom.window.document,
    text: '{"safe":true}',
    platformId: 'sohu',
    version: '0.4.14',
    now: new Date('2026-08-03T08:44:50.000Z'),
  })

  assert.equal(filename, 'draftferry-diagnostic-sohu-0.4.14-20260803-084450.txt')
  assert.deepEqual(createdBlob.parts, ['{"safe":true}'])
  assert.deepEqual(createdBlob.options, { type: 'text/plain;charset=utf-8' })
  assert.deepEqual(clicked, {
    href: 'blob:diagnostic',
    download: filename,
  })
  assert.equal(revokedUrl, 'blob:diagnostic')
  assert.equal(dom.window.document.querySelector('a'), null)
})
