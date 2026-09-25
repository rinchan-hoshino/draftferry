import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createPanel } from '../src/panel.js'

test('紧凑入口不修改页面、焦点或选区', () => {
  const { window } = new JSDOM('<input value="正在编辑的内容"><article>正文</article>')
  const input = window.document.querySelector('input')
  input.focus()
  input.setSelectionRange(1, 4)
  const panel = createPanel(window.document, '腾讯云市场')
  window.document.body.append(panel.host)
  assert.equal(window.document.activeElement, input)
  assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 4])
  assert.equal(window.document.querySelector('article').textContent, '正文')
  assert.ok(panel.host.shadowRoot)
  assert.equal(panel.host.querySelector('button'), null)
  assert.equal(panel.host.shadowRoot.querySelector('.feedback').hidden, true)
  assert.equal(panel.host.shadowRoot.querySelector('details').open, false)
  panel.destroy()
  window.close()
})

test('进度和错误就地显示，不弹窗或抢焦点，忙碌期间阻止重复操作', () => {
  const { window } = new JSDOM('<textarea>继续处理其他工作</textarea>')
  const input = window.document.querySelector('textarea')
  input.focus()
  window.alert = () => assert.fail('反馈不应使用弹窗')
  const panel = createPanel(window.document, '知乎')
  window.document.body.append(panel.host)
  panel.setStatus('正在准备图片…', 'busy')
  assert.equal(panel.button.disabled, true)
  assert.equal(panel.diagnoseButton.disabled, true)
  assert.equal(window.document.activeElement, input)
  panel.setStatus('图片未上传完成，请稍后重试。', 'error')
  assert.equal(panel.button.disabled, false)
  assert.equal(panel.host.shadowRoot.querySelector('[role="status"]').textContent, '图片未上传完成，请稍后重试。')
  assert.equal(window.document.activeElement, input)
  panel.host.shadowRoot.querySelector('.dismiss').click()
  assert.equal(panel.host.shadowRoot.querySelector('.feedback').hidden, true)
  panel.destroy()
  window.close()
})

test('更多菜单只在展开期间监听外部点击，销毁时清理监听器', async () => {
  const { window } = new JSDOM('<main>平台页面</main>')
  const listeners = new Set()
  const add = window.document.addEventListener.bind(window.document)
  const remove = window.document.removeEventListener.bind(window.document)
  window.document.addEventListener = (type, handler, options) => {
    if (type === 'pointerdown') listeners.add(handler)
    add(type, handler, options)
  }
  window.document.removeEventListener = (type, handler, options) => {
    if (type === 'pointerdown') listeners.delete(handler)
    remove(type, handler, options)
  }
  const panel = createPanel(window.document, '搜狐号')
  window.document.body.append(panel.host)
  const menu = panel.host.shadowRoot.querySelector('details')
  assert.equal(listeners.size, 0)
  menu.open = true
  await new Promise(resolve => window.setTimeout(resolve, 0))
  assert.equal(listeners.size, 1)
  window.document.querySelector('main').dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
  await new Promise(resolve => window.setTimeout(resolve, 0))
  assert.equal(menu.open, false)
  assert.equal(listeners.size, 0)
  menu.open = true
  await new Promise(resolve => window.setTimeout(resolve, 0))
  panel.destroy()
  await new Promise(resolve => window.setTimeout(resolve, 0))
  assert.equal(listeners.size, 0)
  assert.equal(panel.host.isConnected, false)
  window.close()
})
