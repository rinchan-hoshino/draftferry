import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

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

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.MutationObserver = RecordingMutationObserver
  dom.window.MutationObserver = RecordingMutationObserver

  try {
    await import(`../src/userscript.js?startup-test=${Date.now()}`)
    const panel = dom.window.document.querySelector('#rin-draftferry-panel')
    assert.ok(panel)
    assert.equal(observers.length, 1)
    assert.equal(observers[0].target, dom.window.document.body)
    assert.deepEqual(observers[0].options, { childList: true })

    panel.remove()
    observers[0].callback()
    assert.ok(dom.window.document.querySelector('#rin-draftferry-panel'))
  } finally {
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.MutationObserver = previous.MutationObserver
    dom.window.close()
  }
})
