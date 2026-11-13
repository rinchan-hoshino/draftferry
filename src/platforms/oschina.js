import { queryFirst, setControlValue, assertReadBack } from '../dom.js'
import { hostMatches } from './shared.js'

// 开源中国只吃 Markdown 文本框。DOM 事实来自 legacy/src/platforms.js 的 MARKDOWN_CONFIGS。
export default {
  id: 'oschina',
  name: '开源中国',
  hosts: ['oschina.net'],
  match(url) {
    return hostMatches(url, this.hosts) && /^\/[^/]+\/blog\/ai-write\/?$/.test(url.pathname)
  },
  findTitle(doc) {
    return queryFirst(doc, ['input[placeholder*="标题"]'])
  },
  findEditor(doc, win) {
    const switchText = doc.querySelector('.editor-switch-text')
    if (switchText?.textContent?.includes('切换到MD编辑器')) {
      throw new Error('开源中国：请先手动切换到 MD 编辑器，再点导入')
    }
    const textarea = doc.querySelector('textarea')
    if (!textarea) throw new Error('开源中国：未找到 Markdown 编辑器')
    return {
      getText: () => textarea.value,
      setHTML(_html, { markdown }) {
        setControlValue(win, textarea, markdown)
        assertReadBack(markdown, textarea.value)
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
  // 开源中国吃 Markdown，不吃 HTML。
  format: 'markdown',
}
