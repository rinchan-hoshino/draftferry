import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { collectPlatformDiagnostics } from '../src/diagnostics.js'

function stringValues(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringValues)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringValues)
  return []
}

function parseDiagnostics(dom, platformId, pageWindow = dom.window) {
  return JSON.parse(collectPlatformDiagnostics({
    document: dom.window.document,
    pageWindow,
    platformId,
    version: 'test-version',
  }))
}

test('阿里云诊断只采集结构、必填标记和页面实例，不读取字段内容或查询参数', () => {
  const dom = new JSDOM(`
    <input value="PRIVATE PRODUCT NAME">
    <div id="ACCOUNT-PRIVATE-ID" class="acpn-form-item account-private-class">
      <label><span>*</span> 产品详情：</label>
      <div id="CREDENTIAL-PRIVATE" class="cke cke_editor_editor3">PRIVATE DETAIL</div>
    </div>
  `, { url: 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=PRIVATE-ID' })
  dom.window.CKEDITOR = { instances: { editor3: {} } }

  const text = collectPlatformDiagnostics({
    document: dom.window.document,
    pageWindow: dom.window,
    platformId: 'aliyun-market',
    version: 'test-version',
  })
  const result = JSON.parse(text)

  assert.equal(result.route, undefined)
  assert.equal(result.aliyun.labels.some((label) => (
    label.labelKind === '产品详情' && label.hasRequiredMarker
  )), true)
  assert.deepEqual(result.aliyun.ckeditorInstances, {
    count: 1,
    numberedEditorKeys: 1,
    otherKeys: 0,
  })
  assert.equal(text.includes('PRIVATE PRODUCT NAME'), false)
  assert.equal(text.includes('PRIVATE DETAIL'), false)
  assert.equal(text.includes('PRIVATE-ID'), false)
  assert.equal(text.includes('ACCOUNT-PRIVATE-ID'), false)
  assert.equal(text.includes('CREDENTIAL-PRIVATE'), false)
  assert.equal(text.includes('account-private-class'), false)
})

test('搜狐诊断报告隐藏副本、页面桥和容器实例，但不读取正文', () => {
  const sandbox = new JSDOM('<main></main>', { url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle' })
  const page = new JSDOM(`
    <section hidden><div class="ql-container"><div class="ql-editor" contenteditable="PRIVATE-EDITABLE">PRIVATE HIDDEN</div></div></section>
    <div class="ql-container active"><div class="ql-editor" contenteditable="true">PRIVATE ARTICLE</div></div>
  `, { url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?secret=PRIVATE' })
  const container = page.window.document.querySelector('.active')
  container.__quill = {
    getContents() {},
    setContents() {},
    clipboard: { dangerouslyPasteHTML() {} },
  }

  const text = collectPlatformDiagnostics({
    document: page.window.document,
    pageWindow: page.window,
    platformId: 'sohu',
    version: 'test-version',
  })
  const result = JSON.parse(text)

  assert.equal(result.sohu.length, 2)
  assert.equal(result.sohu[0].editor.hidden, true)
  assert.equal(result.sohu[1].containerHasValidatedQuill, true)
  assert.equal(result.sohu[1].containerOwnPropertyKinds.includes('quill'), true)
  assert.equal(text.includes('PRIVATE HIDDEN'), false)
  assert.equal(text.includes('PRIVATE ARTICLE'), false)
  assert.equal(text.includes('PRIVATE-EDITABLE'), false)
  assert.equal(text.includes('secret='), false)
  const values = stringValues(result)
  assert.equal(values.includes('ql-container'), false)
  assert.equal(values.includes('ql-editor'), false)
  assert.equal(parseDiagnostics(sandbox, 'sohu', page.window).pageBridge, true)
})

test('腾讯云诊断记录带星号标签、编辑器几何和有限祖先结构', () => {
  const dom = new JSDOM(`
    <section class="market-product-detail">
      <span class="form-label">商品详情 *</span>
      <div class="editor-shell"><div id="text-ele-123" class="w-e-text" contenteditable="true">PRIVATE</div></div>
    </section>
  `, { url: 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET' })
  const editor = dom.window.document.querySelector('.w-e-text')
  editor.getBoundingClientRect = () => ({ x: 100, y: 30, width: 800, height: 300 })

  const text = collectPlatformDiagnostics({
    document: dom.window.document,
    pageWindow: dom.window,
    platformId: 'tencent-market',
    version: 'test-version',
  })
  const result = JSON.parse(text)

  assert.equal(result.tencent.labels.some((label) => (
    label.labelKind === '商品详情' && label.hasRequiredMarker
  )), true)
  assert.equal(result.tencent.editors[0].rect.width, 800)
  assert.equal(
    result.tencent.editors[0].ancestors[0].classSignals.includes('contains-editor'),
    true,
  )
  assert.equal(text.includes('PRIVATE'), false)
})
