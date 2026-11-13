import { queryFirst, writeTitleControl, assertReadBack } from '../dom.js'
import { hostMatches } from './shared.js'

// DOM 事实来自 legacy/src/adapters/baijiahao.js 与 0.7.1 诊断文件。
const TITLE_SELECTORS = [
  '.client_components_titleInput [contenteditable="true"]',
  '.client_pages_edit_components_titleInput [contenteditable="true"]',
  '[class*="titleInput"] [contenteditable="true"]',
]

// 百家号是单页应用：发完一篇再开新稿会新建 UEditor 实例，旧实例还留在 instants 里，正文已脱离页面。
// 每次导入都重新取，取编号最大且仍挂在页面上的那一个。
export function findLiveEditor(pageWindow) {
  const instants = pageWindow?.UE_V2?.instants ?? {}
  const live = Object.entries(instants)
    .filter(([, editor]) => typeof editor?.getContent === 'function' && typeof editor?.setContent === 'function')
    .filter(([, editor]) => editor.body?.isConnected !== false && editor.iframe?.isConnected !== false)
    .sort(([a], [b]) => (Number(a.match(/\d+$/)?.[0] ?? -1) - Number(b.match(/\d+$/)?.[0] ?? -1)))
  return live.at(-1)?.[1] ?? null
}

export default {
  id: 'baijiahao',
  name: '百家号',
  hosts: ['baijiahao.baidu.com'],
  match(url) {
    return hostMatches(url, this.hosts) && /^\/builder\/rc\/edit\/?$/.test(url.pathname)
  },
  findTitle(doc) {
    return queryFirst(doc, TITLE_SELECTORS)
  },
  findEditor(doc, win) {
    const editor = findLiveEditor(win)
    if (!editor) throw new Error('没找到正在编辑的正文，请确认页面是百家号图文编辑页')
    return {
      getText: () => editor.getContent() ?? '',
      setHTML(html) {
        editor.setContent('')
        editor.setContent(html)
        editor.fireEvent?.('contentChange')
        assertReadBack(html, editor.getContent() ?? '')
      },
    }
  },
  writeTitle: writeTitleControl,
}
