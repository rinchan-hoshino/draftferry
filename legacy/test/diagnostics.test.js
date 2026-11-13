import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { collectPlatformDiagnostics } from '../src/diagnostics.js'
import { collectFrameworkInstances } from '../src/framework-diagnostics.js'

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
  const [hiddenContainer, container] = page.window.document.querySelectorAll('.ql-container')
  let getterReads = 0
  Object.defineProperty(hiddenContainer, '__quill', {
    configurable: true,
    get() { getterReads += 1; throw new Error('must not read') },
  })
  container.__quill = {
    getContents() {},
    setContents() {},
    getLength() {},
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
  assert.equal(getterReads, 0)
  assert.equal(text.includes('PRIVATE HIDDEN'), false)
  assert.equal(text.includes('PRIVATE ARTICLE'), false)
  assert.equal(text.includes('PRIVATE-EDITABLE'), false)
  assert.equal(text.includes('secret='), false)
  const values = stringValues(result)
  assert.equal(values.includes('ql-container'), false)
  assert.equal(values.includes('ql-editor'), false)
  assert.equal(parseDiagnostics(sandbox, 'sohu', page.window).pageBridge, true)
})

test('搜狐诊断从 Vue 组件数据找到关联编辑器的 Quill API，但不读取 getter 或组件内容', () => {
  const dom = new JSDOM(`
    <div class="vue-owner"><div class="ql-container"><div class="ql-editor" contenteditable="true"></div></div></div>
  `, { url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle' })
  const { document } = dom.window
  const editor = document.querySelector('.ql-editor')
  const container = document.querySelector('.ql-container')
  const owner = document.querySelector('.vue-owner')
  const quill = {
    root: editor,
    container,
    clipboard: { dangerouslyPasteHTML() {} },
    getContents() {},
    setContents() {},
    getLength() {},
    PRIVATE_COMPONENT_BODY: 'PRIVATE BODY',
  }
  let getterReads = 0
  const data = { quill }
  Object.defineProperty(data, 'editor', {
    enumerable: true,
    get() { getterReads += 1; throw new Error('must not read') },
  })
  Object.defineProperty(owner, '__vue__', {
    configurable: true,
    value: { _data: data },
  })

  const text = collectPlatformDiagnostics({
    document,
    pageWindow: dom.window,
    platformId: 'sohu',
    version: 'test-version',
  })
  const result = JSON.parse(text)
  const framework = result.sohu[0].frameworkInstances

  assert.equal(result.schema, 3)
  assert.equal(framework.ownerCounts.vue2, 1)
  assert.deepEqual(framework.candidates, [{
    ownerKind: 'vue2',
    ancestorDepth: 2,
    apiKind: 'quill',
    discoveryDepth: 2,
    relation: 'quill-root',
  }])
  assert.equal(framework.truncated, false)
  assert.equal(getterReads, 0)
  assert.equal(text.includes('PRIVATE'), false)
  assert.equal(text.includes('__vue__'), false)
  assert.equal(text.includes('quill-root'), true)
})

test('搜狐诊断沿 Vue 2 $parent 父链找到真实编辑器组件中的 Quill', () => {
  const dom = new JSDOM('<div class="ql-editor" contenteditable="true"></div>')
  const target = dom.window.document.querySelector('.ql-editor')
  const quill = {
    root: target,
    container: target.parentElement,
    clipboard: { dangerouslyPasteHTML() {} },
    getContents() {},
    setContents() {},
    getLength() {},
  }
  let component = { _data: { quill } }
  for (let depth = 0; depth < 8; depth += 1) component = { $parent: component }
  Object.defineProperty(target, '__vue__', {
    configurable: true,
    value: component,
  })

  const result = collectFrameworkInstances(target)

  assert.deepEqual(result.candidates, [{
    ownerKind: 'vue2',
    ancestorDepth: 0,
    apiKind: 'quill',
    discoveryDepth: 10,
    relation: 'quill-root',
  }])
  assert.equal(result.truncated, false)
})

test('框架诊断不调用候选自定义 contains，并对整次扫描共享 owner 与对象预算', () => {
  const dom = new JSDOM('<div id="target"></div>', { url: 'https://example.invalid/' })
  const target = dom.window.document.querySelector('#target')
  let customContainsCalls = 0
  const quill = {
    root: dom.window.document.createElement('div'),
    container: { contains() { customContainsCalls += 1; return true } },
    clipboard: { dangerouslyPasteHTML() {} },
    getContents() {},
    setContents() {},
    getLength() {},
  }
  Object.defineProperty(target, '__vue__', {
    configurable: true,
    value: { _data: { quill } },
  })
  for (let index = 0; index < 5; index += 1) {
    Object.defineProperty(target, `__reactFiber$PRIVATE_${index}`, {
      configurable: true,
      value: { return: { return: { return: null } } },
    })
  }

  const result = collectFrameworkInstances(target, { maxOwners: 2, maxObjects: 4 })

  assert.equal(customContainsCalls, 0)
  assert.equal(result.ownerCounts.vue2, 1)
  assert.equal(result.ownerCounts.reactFiber, 1)
  assert.equal(result.candidates[0].relation, 'framework-owner')
  assert.equal(result.truncated, true)
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
})

test('腾讯云诊断扫描页面主上下文、开放 ShadowRoot 和同源 iframe 中的通用编辑候选', () => {
  const sandbox = new JSDOM('<main>PRIVATE SANDBOX</main>', { url: 'https://example.invalid/' })
  const page = new JSDOM(`
    <section class="market-product-detail PRIVATE-TOP-CLASS">
      <span class="form-label">商品详情 *</span>
      <div class="editor-shell"><div id="text-ele-123" class="w-e-text" contenteditable="true">PRIVATE TOP</div></div>
    </section>
    <div id="shadow-host"></div>
    <iframe></iframe>
    <iframe id="blocked"></iframe>
  `, { url: 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET' })
  const { document } = page.window
  const topEditor = document.querySelector('.w-e-text')
  topEditor.getBoundingClientRect = () => ({ x: 100, y: 30, width: 800, height: 300 })

  const shadow = document.querySelector('#shadow-host').attachShadow({ mode: 'open' })
  shadow.innerHTML = '<private-editor class="PRIVATE-SHADOW-EDITOR" role="textbox" contenteditable="true">PRIVATE SHADOW</private-editor>'

  const frame = document.querySelector('iframe')
  frame.contentDocument.body.innerHTML = '<textarea class="PRIVATE-FRAME-EDITOR">PRIVATE FRAME</textarea>'
  const blockedFrame = document.querySelector('#blocked')
  Object.defineProperty(blockedFrame, 'contentDocument', {
    configurable: true,
    get() { throw new Error('cross-origin PRIVATE URL') },
  })

  const text = collectPlatformDiagnostics({
    document: sandbox.window.document,
    pageWindow: page.window,
    platformId: 'tencent-market',
    version: 'test-version',
  })
  const result = JSON.parse(text)

  assert.equal(result.schema, 3)
  assert.equal(result.tencent.rootCounts.document, 1)
  assert.equal(result.tencent.rootCounts.shadowRoot, 1)
  assert.equal(result.tencent.rootCounts.iframeDocument, 1)
  assert.equal(result.tencent.inaccessibleIframeCount, 1)
  assert.equal(result.tencent.roots.length, 3)
  assert.equal(result.tencent.roots[0].labels.some((label) => (
    label.labelKind === '商品详情' && label.hasRequiredMarker
  )), true)
  assert.equal(result.tencent.roots[0].wangEditors[0].rect.width, 800)
  assert.equal(
    result.tencent.roots[0].wangEditors[0].ancestors[0].classSignals.includes('contains-editor'),
    true,
  )
  assert.equal(result.tencent.roots[1].editableCandidates[0].tag, 'other')
  assert.equal(result.tencent.roots[2].editableCandidates[0].tag, 'textarea')
  assert.equal(text.includes('PRIVATE'), false)
  assert.equal(text.includes('example.invalid'), false)
  assert.equal(text.includes('serviceprovider'), false)
  assert.equal(text.includes('private-editor'), false)
})

test('腾讯诊断只沿 React 父 Fiber 和 Hook next 链找到较深的 WangEditor', () => {
  const dom = new JSDOM('<div class="w-e-text" contenteditable="true"></div>')
  const target = dom.window.document.querySelector('.w-e-text')
  const wangEditor = {
    setHtml() {},
    getHtml() {},
    clear() {},
    dangerouslyInsertHtml() {},
  }
  const unrelatedEditor = {
    setHtml() {},
    getHtml() {},
    clear() {},
    dangerouslyInsertHtml() {},
  }
  const secondHook = { memoizedState: wangEditor, next: null }
  const firstHook = { memoizedState: { current: null }, next: secondHook }
  let fiber = { memoizedState: firstHook, return: null }
  for (let depth = 0; depth < 9; depth += 1) fiber = { return: fiber }
  fiber.child = { memoizedProps: { editor: unrelatedEditor } }
  fiber.sibling = { memoizedProps: { editor: unrelatedEditor } }
  fiber.alternate = { memoizedProps: { editor: unrelatedEditor } }
  Object.defineProperty(target, '__reactFiber$PRIVATE_SUFFIX', {
    configurable: true,
    value: fiber,
  })

  const result = collectFrameworkInstances(target)

  assert.deepEqual(result.candidates, [{
    ownerKind: 'reactFiber',
    ancestorDepth: 0,
    apiKind: 'wang-editor',
    discoveryDepth: 12,
    relation: 'framework-owner',
  }])
  assert.equal(result.truncated, false)
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
})

test('框架诊断将固定深度截断计入 truncated', () => {
  const dom = new JSDOM('<div class="w-e-text" contenteditable="true"></div>')
  const target = dom.window.document.querySelector('.w-e-text')
  Object.defineProperty(target, '__reactFiber$PRIVATE_SUFFIX', {
    configurable: true,
    value: { return: { return: { return: null } } },
  })

  const result = collectFrameworkInstances(target, { maxDepth: 1 })

  assert.deepEqual(result.candidates, [])
  assert.equal(result.truncated, true)
})

test('腾讯诊断从 React Fiber 找到 WangEditor API，但不输出 Fiber 名称或组件值', () => {
  const dom = new JSDOM(`
    <section class="next-form-item">
      <label>商品详情</label>
      <div class="w-e-text" contenteditable="true">PRIVATE EDITOR BODY</div>
    </section>
  `, { url: 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET' })
  const { document } = dom.window
  const editorElement = document.querySelector('.w-e-text')
  const wangEditor = {
    setHtml() {},
    getHtml() {},
    clear() {},
    dangerouslyInsertHtml() {},
    PRIVATE_ACCOUNT_VALUE: 'PRIVATE ACCOUNT',
  }
  const fiber = {
    memoizedProps: {
      editor: wangEditor,
      PRIVATE_BODY_VALUE: 'PRIVATE BODY',
    },
    return: null,
  }
  Object.defineProperty(editorElement, '__reactFiber$PRIVATE_SUFFIX', {
    configurable: true,
    value: fiber,
  })

  const text = collectPlatformDiagnostics({
    document,
    pageWindow: dom.window,
    platformId: 'tencent-market',
    version: 'test-version',
  })
  const result = JSON.parse(text)
  const framework = result.tencent.roots[0].wangEditors[0].frameworkInstances

  assert.equal(result.schema, 3)
  assert.equal(framework.ownerCounts.reactFiber, 1)
  assert.deepEqual(framework.candidates, [{
    ownerKind: 'reactFiber',
    ancestorDepth: 0,
    apiKind: 'wang-editor',
    discoveryDepth: 2,
    relation: 'framework-owner',
  }])
  assert.equal(framework.truncated, false)
  assert.equal(text.includes('PRIVATE'), false)
  assert.equal(text.includes('__reactFiber'), false)
  assert.equal(text.includes('memoizedProps'), false)
})
