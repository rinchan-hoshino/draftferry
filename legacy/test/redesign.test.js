import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createPanel } from '../src/panel.js'

test('English panel keeps filenames and import actions while localizing recovery feedback', () => {
  const { window } = new JSDOM('<html lang="en"><body><textarea>My draft</textarea></body></html>')
  const actions = []
  const panel = createPanel(window.document, '知乎', action => actions.push(action))
  window.document.body.append(panel.host)
  assert.equal(panel.button.textContent, 'Import Markdown')
  panel.setState({ phase: 'reading', assets: [] })
  panel.setState({ phase: 'failed', assets: [], filename: '测试 <file>.md', message: '知乎：未找到标题输入框', canResume: true })
  const root = panel.host.shadowRoot
  assert.equal(root.querySelector('.filename').textContent, '测试 <file>.md')
  assert.equal(root.querySelector('[role="status"]').textContent, 'Zhihu: Title input field not found')
  root.querySelector('[data-primary]').click()
  assert.deepEqual(actions, ['resume'])
  panel.collapse()
  panel.button.click()
  assert.equal(root.querySelector('.filename').textContent, '测试 <file>.md')
  assert.equal(root.querySelector('file'), null)
  panel.destroy()
  window.close()
})
