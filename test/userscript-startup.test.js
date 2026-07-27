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
  let copiedDiagnostic = ''
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { async writeText(text) { copiedDiagnostic = text } },
  })

  await withUserscriptGlobals(dom, async () => {
    globalThis.MutationObserver = RecordingMutationObserver
    await import(`../src/userscript.js?startup-test=${Date.now()}`)
    const panel = dom.window.document.querySelector('#rin-draftferry-panel')
    assert.ok(panel)
    assert.equal(
      panel.querySelector('[data-rin-action="diagnose"]')?.textContent,
      '复制诊断',
    )
    panel.querySelector('[data-rin-action="diagnose"]').click()
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0))
    assert.match(copiedDiagnostic, /"draftferryVersion": "test-version"/)
    assert.match(panel.querySelector('[data-rin-status]').textContent, /诊断已复制/)

    const fileInput = panel.querySelector('[data-rin-files]')
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
