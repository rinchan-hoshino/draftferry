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
