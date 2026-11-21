import { assertReadBack, queryFirst, setControlValue } from '../dom.ts'
import type { PlatformAdapter } from '../types.ts'
import { hostMatches } from './shared.ts'

const oschina: PlatformAdapter = {
  id: 'oschina',
  name: '开源中国',
  hosts: ['oschina.net'],
  format: 'markdown',
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
      setHTML(_html, { markdown = '', onProgress } = {}) {
        onProgress?.('写入正文…')
        setControlValue(win, textarea, markdown)
        assertReadBack(markdown, textarea.value)
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
}

export default oschina
