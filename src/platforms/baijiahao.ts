import { assertReadBack, queryFirst, writeTitleControl } from '../dom.ts'
import type { PlatformAdapter } from '../types.ts'
import { hostMatches } from './shared.ts'

const TITLE_SELECTORS = [
  '.client_components_titleInput [contenteditable="true"]',
  '.client_pages_edit_components_titleInput [contenteditable="true"]',
  '[class*="titleInput"] [contenteditable="true"]',
]

export interface UEditorInstance {
  getContent: () => string
  setContent: (html: string) => void
  fireEvent?: (name: string) => void
  body?: { isConnected?: boolean }
  iframe?: { isConnected?: boolean }
}

export function findLiveEditor(pageWindow: Window): UEditorInstance | null {
  const instants =
    (pageWindow as unknown as { UE_V2?: { instants?: Record<string, UEditorInstance> } }).UE_V2
      ?.instants ?? {}
  const live = Object.entries(instants)
    .filter(
      ([, editor]) =>
        typeof editor?.getContent === 'function' && typeof editor?.setContent === 'function',
    )
    .filter(
      ([, editor]) => editor.body?.isConnected !== false && editor.iframe?.isConnected !== false,
    )
    .sort(
      ([a], [b]) =>
        Number(a.match(/\d+$/)?.[0] ?? -1) - Number(b.match(/\d+$/)?.[0] ?? -1),
    )
  return live.at(-1)?.[1] ?? null
}

const baijiahao: PlatformAdapter = {
  id: 'baijiahao',
  name: '百家号',
  hosts: ['baijiahao.baidu.com'],
  match(url) {
    return hostMatches(url, this.hosts) && /^\/builder\/rc\/edit\/?$/.test(url.pathname)
  },
  findTitle(doc) {
    return queryFirst(doc, TITLE_SELECTORS)
  },
  findEditor(_doc, win) {
    const editor = findLiveEditor(win)
    if (!editor) throw new Error('没找到正在编辑的正文，请确认页面是百家号图文编辑页')
    return {
      getText: () => editor.getContent() ?? '',
      setHTML(html, { onProgress } = {}) {
        onProgress?.('写入正文…')
        editor.setContent('')
        editor.setContent(html)
        editor.fireEvent?.('contentChange')
        assertReadBack(html, editor.getContent() ?? '')
      },
    }
  },
  writeTitle: writeTitleControl,
}

export default baijiahao
