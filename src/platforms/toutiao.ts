import { assertReadBack, queryFirst, setControlValue } from '../dom.ts'
import type { PlatformAdapter } from '../types.ts'
import { hostMatches } from './shared.ts'

const toutiao: PlatformAdapter = {
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
      setHTML(html, { onProgress } = {}) {
        onProgress?.('写入正文…')
        if (typeof doc.execCommand !== 'function') {
          throw new Error('今日头条：浏览器不支持 insertHTML 编辑命令')
        }
        const container = doc.createElement('div')
        container.innerHTML = html
        for (const image of container.querySelectorAll('img')) {
          image.setAttribute('needCheck', 'true')
          image.setAttribute('paste', 'true')
        }
        editor.focus({ preventScroll: true })
        const range = doc.createRange()
        range.selectNodeContents(editor)
        const selection = win.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        if (!doc.execCommand('insertHTML', false, container.innerHTML)) {
          throw new Error('今日头条：编辑器拒绝 insertHTML')
        }
        const winTyped = win as unknown as {
          InputEvent: typeof InputEvent
          Event: typeof Event
        }
        editor.dispatchEvent(
          new winTyped.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }),
        )
        editor.dispatchEvent(new winTyped.Event('change', { bubbles: true }))
        assertReadBack(html, editor.innerHTML)
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
}

export default toutiao
