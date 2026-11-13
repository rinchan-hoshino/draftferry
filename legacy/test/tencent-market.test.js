import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { injectPlatformArticle } from '../src/platforms.js'
import { collectFrameworkInstances, findLegacyWangEditor } from '../src/framework-diagnostics.js'

const url = 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET'
const article = {
  html: '<h2>新正文</h2><p>前<img src="data:image/png;base64,eA==">后</p><table><tbody><tr><td>单元格</td></tr></tbody></table>',
  portableMarkdown: '新正文',
}

function fixture() {
  const { window } = new JSDOM('<input id="other" value="其他字段"><section><label>商品详情</label><div class="w-e-text" contenteditable="true"><p>原正文</p></div></section>', { url })
  window.confirm = () => true
  const element = window.document.querySelector('.w-e-text')
  const native = {
    create() {}, destroy() {}, initSelection() {},
    $textElem: { elems: [element] },
    config: { customUploadImg(_files, insert) { insert('https://example.com/image.png') } },
    txt: { html(value) { if (value !== undefined) element.innerHTML = value; return element.innerHTML } },
    uploadImg: { uploadImg(files) { this.editor.config.customUploadImg(files, this.insertImg.bind(this)) } },
  }
  native.uploadImg.editor = native
  element.__reactFiber$test = { return: { memoizedState: { next: { memoizedState: native } } } }
  return { window, element, native }
}

test('腾讯通过关联原生接口整篇替换，图片位置不依赖页面选区', async () => {
  const { window, element, native } = fixture()
  const other = window.document.querySelector('input')
  other.focus()
  other.setSelectionRange(1, 3)
  window.document.execCommand = () => assert.fail('不得执行全局编辑命令')
  window.addEventListener('paste', () => assert.fail('不得冒泡粘贴'))
  const originalFetch = window.fetch
  const originalSend = window.XMLHttpRequest.prototype.send
  const originalUploader = native.uploadImg.uploadImg
  let writes = 0
  const setHtml = native.txt.html
  native.txt.html = (value) => { if (value !== undefined) writes += 1; return setHtml(value) }
  await injectPlatformArticle(window.document, article)
  assert.equal(writes, 1)
  assert.equal(element.textContent, '新正文前后单元格')
  assert.equal(element.querySelector('img').previousSibling.textContent, '前')
  assert.equal(element.querySelector('img').nextSibling.textContent, '后')
  assert.equal(element.querySelector('img').src, 'https://example.com/image.png')
  assert.equal(window.document.activeElement, other)
  assert.equal(other.selectionStart, 1)
  assert.equal(other.selectionEnd, 3)
  assert.equal(window.fetch, originalFetch)
  assert.equal(window.XMLHttpRequest.prototype.send, originalSend)
  assert.equal(native.uploadImg.uploadImg, originalUploader)
  assert.equal(element.getAttribute('contenteditable'), 'true')
  assert.equal(element.hasAttribute('aria-busy'), false)
  window.close()
})

test('腾讯上传超时保留原文，迟到回调与后续人工输入互不影响', async () => {
  const { window, element, native } = fixture()
  let lateCallback
  native.config.customUploadImg = (_files, callback) => { lateCallback = callback }
  const promise = injectPlatformArticle(window.document, article, { imageUploadTimeoutMs: 5 })
  assert.equal(element.innerHTML, '<p>原正文</p>')
  assert.equal(element.getAttribute('contenteditable'), 'false')
  await assert.rejects(promise, /上传超时/)
  assert.equal(element.innerHTML, '<p>原正文</p>')
  assert.equal(element.getAttribute('contenteditable'), 'true')
  element.innerHTML = '<p>用户继续编辑</p>'
  lateCallback('https://example.com/late.png')
  await new Promise((resolve) => window.setTimeout(resolve, 20))
  assert.equal(element.innerHTML, '<p>用户继续编辑</p>')
  window.close()
})

test('腾讯上传时页面切换或其他脚本改动正文会停止提交', async () => {
  for (const reason of ['route', 'changed', 'detached']) {
    const { window, element, native } = fixture()
    let finish
    native.config.customUploadImg = (_files, insert) => { finish = insert }
    const pending = injectPlatformArticle(window.document, article)
    if (reason === 'route') window.history.pushState({}, '', `${url}&id=another`)
    if (reason === 'changed') element.innerHTML = '<p>平台新内容</p>'
    if (reason === 'detached') element.remove()
    finish('https://example.com/image.png')
    await assert.rejects(pending, /已停止导入/)
    assert.equal(element.innerHTML, reason === 'changed' ? '<p>平台新内容</p>' : '<p>原正文</p>')
    assert.equal(element.getAttribute('contenteditable'), 'true')
    window.close()
  }
})

test('腾讯写入丢失正文或结构时只回滚一次，不留下恢复监听器', async () => {
  const { window, element, native } = fixture()
  let writes = 0
  native.txt.html = (value) => {
    if (value !== undefined) {
      writes += 1
      element.innerHTML = writes === 1 ? '<h2>新正文</h2>' : value
    }
    return element.innerHTML
  }
  await assert.rejects(injectPlatformArticle(window.document, article), /正文写入不完整/)
  assert.equal(writes, 2)
  assert.equal(element.innerHTML, '<p>原正文</p>')
  element.innerHTML = '<p>错误后人工修改</p>'
  await new Promise((resolve) => window.setTimeout(resolve, 10))
  assert.equal(element.textContent, '错误后人工修改')
  window.close()
})

test('腾讯仅接受唯一且根元素匹配的 legacy wangEditor，诊断不暴露实例', async () => {
  const { window, element, native } = fixture()
  assert.equal(findLegacyWangEditor(element), native)
  const report = collectFrameworkInstances(element)
  assert.equal(report.candidates[0].apiKind, 'wang-editor-legacy')
  assert.equal(report.candidates[0].relation, 'wang-editor-root')
  assert.doesNotMatch(JSON.stringify(report), /原正文|customUploadImg|w-e-text/)
  native.$textElem.elems[0] = window.document.createElement('div')
  await assert.rejects(injectPlatformArticle(window.document, article), /无法确认商品详情的编辑器接口/)
  assert.equal(element.innerHTML, '<p>原正文</p>')
  window.close()
})

test('腾讯兼容没有 destroy 的 v3 接口，锁住索引式工具栏并通知宿主正文变化', async () => {
  const { window, element, native } = fixture()
  delete native.destroy
  native.$textElem = { 0: element, length: 1 }
  const toolbar = window.document.createElement('div')
  element.before(toolbar)
  native.$toolbarElem = { 0: toolbar, length: 1 }
  const changes = []
  native.change = () => changes.push(native.txt.html())
  native.config.customUploadImg = (_files, insert) => {
    assert.equal(toolbar.getAttribute('aria-busy'), 'true')
    insert('https://example.com/v3.png')
  }
  assert.equal(findLegacyWangEditor(element), native)
  await injectPlatformArticle(window.document, article)
  assert.deepEqual(changes, [element.innerHTML])
  assert.equal(element.querySelector('img').src, 'https://example.com/v3.png')
  assert.equal(toolbar.hasAttribute('aria-busy'), false)
  window.close()
})

test('腾讯 v3 写入校验失败时只将已恢复的原文通知宿主', async () => {
  const { window, element, native } = fixture()
  delete native.destroy
  const changes = []
  native.change = () => changes.push(element.innerHTML)
  let writes = 0
  native.txt.html = (value) => {
    if (value !== undefined) element.innerHTML = ++writes === 1 ? '<p>不完整</p>' : value
    return element.innerHTML
  }
  await assert.rejects(injectPlatformArticle(window.document, article), /正文写入不完整/)
  assert.deepEqual(changes, ['<p>原正文</p>'])
  window.close()
})

test('腾讯遵守 v3 上传钩子的 prevent 结果，不发送图片或改动原文', async () => {
  const { window, element, native } = fixture()
  delete native.config.customUploadImg
  native.config.uploadImgServer = 'https://example.com/upload'
  native.config.uploadImgHooks = { before: () => ({ prevent: true, msg: '平台拒绝上传' }) }
  window.XMLHttpRequest.prototype.send = () => assert.fail('平台拒绝后不得发送上传请求')
  await assert.rejects(injectPlatformArticle(window.document, article), /上传失败/)
  assert.equal(element.innerHTML, '<p>原正文</p>')
  assert.equal(element.getAttribute('contenteditable'), 'true')
  window.close()
})

test('腾讯从 React 组件自己的编辑器引用导入，不因外层页面图被截断而拒绝已匹配接口', async () => {
  const { window, element, native } = fixture()
  let outer = { return: null }
  for (let depth = 0; depth < 40; depth++) outer = { return: outer }
  element.__reactFiber$test = {
    return: { stateNode: { richTextInstance: native }, return: outer },
  }
  let getterReads = 0
  Object.defineProperty(element.__reactFiber$test.return.stateNode, 'privateData', {
    get() { getterReads++; throw new Error('不得调用组件 getter') },
  })
  assert.equal(findLegacyWangEditor(element), native)
  const report = collectFrameworkInstances(element)
  assert.equal(report.truncated, true)
  assert.equal(report.candidates[0].relation, 'wang-editor-root')
  assert.doesNotMatch(JSON.stringify(report), /richTextInstance|privateData|原正文/)
  await injectPlatformArticle(window.document, article)
  assert.equal(element.textContent, '新正文前后单元格')
  assert.equal(getterReads, 0)
  window.close()
})

test('腾讯识别 React state 和 memo 数组中的实例，并拒绝另一编辑器及重复根接口', () => {
  const { window, element, native } = fixture()
  const wrong = { ...native, $textElem: { elems: [window.document.createElement('div')] } }
  element.__reactFiber$test = {
    stateNode: { state: { detail: wrong } },
    memoizedState: { memoizedState: [native, []], next: null },
  }
  assert.equal(findLegacyWangEditor(element), native)
  element.__reactFiber$test.stateNode.state.detail = { ...native }
  assert.equal(findLegacyWangEditor(element), null)
  window.close()
})

test('腾讯原文恢复失败时不会错误提示恢复成功', async () => {
  const { window, element, native } = fixture()
  native.txt.html = (value) => {
    if (value !== undefined) element.innerHTML = '<p>不完整</p>'
    return element.innerHTML
  }
  await assert.rejects(injectPlatformArticle(window.document, article), /无法恢复原文/)
  assert.equal(element.getAttribute('contenteditable'), 'true')
  window.close()
})

test('腾讯取消确认不启动上传，重复图片只上传一次', async () => {
  const { window, element, native } = fixture()
  let uploads = 0
  native.config.customUploadImg = (_files, insert) => {
    uploads += 1
    insert('https://example.com/image.png')
  }
  window.confirm = () => false
  await assert.rejects(injectPlatformArticle(window.document, article), /已取消导入/)
  assert.equal(uploads, 0)
  window.confirm = () => true
  await injectPlatformArticle(window.document, { ...article, html: article.html + article.html })
  assert.equal(uploads, 1)
  assert.equal(element.querySelectorAll('img').length, 2)
  window.close()
})
