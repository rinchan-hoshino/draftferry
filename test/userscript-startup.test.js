import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

async function withUserscriptGlobals(dom, callback) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    __DRAFTFERRY_VERSION__: globalThis.__DRAFTFERRY_VERSION__,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.MutationObserver = dom.window.MutationObserver
  globalThis.__DRAFTFERRY_VERSION__ = 'test-version'
  try {
    await callback()
  } finally {
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0))
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.MutationObserver = previous.MutationObserver
    globalThis.__DRAFTFERRY_VERSION__ = previous.__DRAFTFERRY_VERSION__
    dom.window.close()
  }
}

test('稿渡只监听 body 直属子节点，并可在面板被移除后恢复', async () => {
  const dom = new JSDOM(`<!doctype html><html><head><meta name="rin-platform-fixture" content="zhihu"></head><body></body></html>`, {
    url: 'file:///draftferry-startup.html',
  })
  const observers = []
  class RecordingMutationObserver {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe(target, options) {
      this.target = target
      this.options = options
    }
    disconnect() {}
  }

  dom.window.MutationObserver = RecordingMutationObserver
  let downloadedFilename = ''
  dom.window.URL.createObjectURL = () => 'blob:diagnostic'
  dom.window.URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    downloadedFilename = this.download
  }

  await withUserscriptGlobals(dom, async () => {
    globalThis.MutationObserver = RecordingMutationObserver
    await import(`../src/userscript.js?startup-test=${Date.now()}`)
    const panel = dom.window.document.querySelector('#rin-draftferry-panel')
    assert.ok(panel)
    assert.equal(
      panel.shadowRoot.querySelector('[data-rin-action="diagnose"]')?.textContent,
      '下载诊断',
    )
    assert.equal(panel.shadowRoot.querySelector('[data-rin-action="sohu-preflight"]'), null)
    panel.shadowRoot.querySelector('[data-rin-action="diagnose"]').click()
    assert.match(downloadedFilename, /^draftferry-diagnostic-zhihu-test-version-/)
    assert.match(panel.shadowRoot.querySelector('[data-rin-status]').textContent, /已开始下载诊断/)

    const fileInput = panel.shadowRoot.querySelector('[data-rin-files]')
    assert.equal(fileInput.style.getPropertyValue('display'), 'none')
    assert.equal(fileInput.style.getPropertyPriority('display'), 'important')
    assert.equal(observers.length, 1)
    assert.equal(observers[0].target, dom.window.document.body)
    assert.deepEqual(observers[0].options, { childList: true })

    panel.remove()
    observers[0].callback()
    assert.ok(dom.window.document.querySelector('#rin-draftferry-panel'))
  })
})

test('搜狐页面单击下载诊断即可取得全页结构和实例分层结果', async () => {
  const dom = new JSDOM(`<!doctype html><html><head><meta name="rin-platform-fixture" content="sohu"></head><body>
    <div class="ql-container"><div class="ql-editor" contenteditable="true"><p><br></p></div></div>
  </body></html>`, { url: 'file:///draftferry-sohu-diagnostic.html' })
  disableAutomaticMutationCallbacks(dom)
  let createdBlob = null
  let downloadedFilename = ''
  dom.window.Blob = class {
    constructor(parts, options) {
      this.parts = parts
      this.options = options
      createdBlob = this
    }
  }
  dom.window.URL.createObjectURL = () => 'blob:diagnostic'
  dom.window.URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    downloadedFilename = this.download
  }

  await withUserscriptGlobals(dom, async () => {
    await import(`../src/userscript.js?sohu-diagnostic-test=${Date.now()}`)
    const panel = dom.window.document.querySelector('#rin-draftferry-panel')
    const button = panel.shadowRoot.querySelector('[data-rin-action="diagnose"]')

    assert.equal(button?.textContent, '下载诊断')
    assert.equal(panel.shadowRoot.querySelector('[data-rin-action="sohu-preflight"]'), null)
    button.click()

    const result = JSON.parse(createdBlob.parts.join(''))
    assert.match(downloadedFilename, /^draftferry-diagnostic-sohu-test-version-/)
    assert.equal(result.safeDomMap.elementCount > 0, true)
    assert.equal(result.sohuEditorPreflight.result, 'slot-missing')
    assert.match(panel.shadowRoot.querySelector('[data-rin-status]').textContent, /已开始下载诊断/)
  })
})

function disableAutomaticMutationCallbacks(dom) {
  dom.window.MutationObserver = class {
    constructor(callback) { this.callback = callback }
    observe() {}
    disconnect() {}
  }
}

test('四个后台通过 SPA 进入真实编辑路由时才挂载面板', async () => {
  const cases = [
    {
      listUrl: 'https://baijiahao.baidu.com/builder/rc/home',
      editorPath: '/builder/rc/edit?type=news&is_from_cms=1',
    },
    {
      listUrl: 'https://mp.toutiao.com/profile_v4/index',
      editorPath: '/profile_v4/graphic/publish',
    },
    {
      listUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/list',
      editorPath: '/mpfe/v4/contentManagement/news/addarticle?contentStatus=1',
    },
    {
      listUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=list',
      editorPath: '/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit',
    },
  ]

  for (const [index, { listUrl, editorPath }] of cases.entries()) {
    const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
      url: listUrl,
    })
    disableAutomaticMutationCallbacks(dom)
    const navigation = new dom.window.EventTarget()
    Object.defineProperty(dom.window, 'navigation', {
      configurable: true,
      value: navigation,
    })

    await withUserscriptGlobals(dom, async () => {
      await import(`../src/userscript.js?spa-test=${Date.now()}-${index}`)
      assert.equal(dom.window.document.querySelector('#rin-draftferry-panel'), null)

      dom.window.history.pushState({}, '', editorPath)
      navigation.dispatchEvent(new dom.window.Event('currententrychange'))
      assert.ok(dom.window.document.querySelector('#rin-draftferry-panel'))

      dom.window.history.pushState({}, '', new URL(listUrl).pathname)
      navigation.dispatchEvent(new dom.window.Event('currententrychange'))
      assert.equal(dom.window.document.querySelector('#rin-draftferry-panel'), null)
    })
  }
})

test('没有 Navigation API 时可通过 popstate 挂载后台编辑面板', async () => {
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
    url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/list',
  })
  disableAutomaticMutationCallbacks(dom)

  await withUserscriptGlobals(dom, async () => {
    await import(`../src/userscript.js?popstate-test=${Date.now()}`)
    assert.equal(dom.window.document.querySelector('#rin-draftferry-panel'), null)

    dom.window.history.pushState(
      {},
      '',
      '/mpfe/v4/contentManagement/news/addarticle?contentStatus=1',
    )
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
    assert.ok(dom.window.document.querySelector('#rin-draftferry-panel'))
  })
})

test('阿里云空闲时静默切换地址也能显示和移除面板', async () => {
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
    url: 'https://msp.aliyun.com/msp/commodity/list',
    pretendToBeVisual: true,
  })
  disableAutomaticMutationCallbacks(dom)

  await withUserscriptGlobals(dom, async () => {
    await import(`../src/userscript.js?aliyun-idle-test=${Date.now()}`)
    assert.equal(dom.window.document.querySelector('#rin-draftferry-panel'), null)
    dom.window.history.pushState({}, '', '/msp/commodity/list/~/publish/basic?commodityId=69735')
    await new Promise(resolve => dom.window.setTimeout(resolve, 900))
    assert.ok(dom.window.document.querySelector('#rin-draftferry-panel'))

    dom.window.history.replaceState({}, '', '/msp/commodity/list')
    await new Promise(resolve => dom.window.setTimeout(resolve, 900))
    assert.equal(dom.window.document.querySelector('#rin-draftferry-panel'), null)
  })
})

test('油猴地址通知和页面恢复均能重新检查阿里云编辑入口', async () => {
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
    url: 'https://msp.aliyun.com/',
    pretendToBeVisual: true,
  })
  disableAutomaticMutationCallbacks(dom)
  dom.window.onurlchange = null

  await withUserscriptGlobals(dom, async () => {
    await import(`../src/userscript.js?aliyun-urlchange-test=${Date.now()}`)
    assert.equal(dom.window.document.querySelector('#rin-draftferry-panel'), null)
    dom.window.history.pushState({}, '', '/msp/commodity/list/~/publish/basic?commodityId=69735')
    dom.window.dispatchEvent(new dom.window.Event('urlchange'))
    assert.ok(dom.window.document.querySelector('#rin-draftferry-panel'))

    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }))
    dom.window.history.replaceState({}, '', '/msp/commodity/list')
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }))
    assert.equal(dom.window.document.querySelector('#rin-draftferry-panel'), null)
  })
})
