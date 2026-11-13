import { queryFirst, setControlValue, assertReadBack } from '../dom.js'
import { hostMatches } from './shared.js'

// DOM 事实来自 legacy/src/adapters/toutiao.js：标题是 textarea，正文是 ProseMirror，用 insertHTML 写入。
export default {
  id: 'toutiao',
  name: '今日头条',
  hosts: ['toutiao.com'],
  match(url) {
    return hostMatches(url, this.hosts) && /^\/profile_v4\/graphic\/publish\/?$/.test(url.pathname)
  },
  findTitle(doc) {
    return queryFirst(doc, ['textarea[placeholder*="标题"]'])
  },
  findEditor(doc, win) {
    const editor = queryFirst(doc, ['.ProseMirror[contenteditable="true"]', '.ProseMirror'])
    if (!editor) throw new Error('今日头条：未找到正文编辑器')
    return {
      getText: () => editor.textContent ?? '',
      setHTML(html) {
        if (typeof doc.execCommand !== 'function') throw new Error('今日头条：浏览器不支持 insertHTML 编辑命令')
        const container = doc.createElement('div')
        container.innerHTML = html
        // 头条粘贴图片会走自家检查，这两个属性和旧适配器保持一致。
        for (const image of container.querySelectorAll('img')) {
          image.setAttribute('needCheck', 'true')
          image.setAttribute('paste', 'true')
        }
        editor.focus({ preventScroll: true })
        // 整篇替换：先选中编辑器全部内容，再用 insertHTML 覆盖。
        const range = doc.createRange()
        range.selectNodeContents(editor)
        const selection = win.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        if (!doc.execCommand('insertHTML', false, container.innerHTML)) throw new Error('今日头条：编辑器拒绝 insertHTML')
        editor.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }))
        editor.dispatchEvent(new win.Event('change', { bubbles: true }))
        assertReadBack(html, editor.innerHTML)
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
}
