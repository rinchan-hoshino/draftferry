import { parseHtml, queryFirst, readControlValue, writeControl } from './common.js'
import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from '../editor-content.js'
import { allowImporterInput } from '../editor-lock.js'

export function findBaijiahaoTitle(document) {
  return queryFirst(document, [
    '.client_components_titleInput [contenteditable="true"]',
    '.client_pages_edit_components_titleInput [contenteditable="true"]',
    '[class*="titleInput"] [contenteditable="true"]',
  ])
}

// 百家号是单页应用：发完一篇再开新稿会建新的 UEditor 实例，旧的 ueditorInstant0
// 还留在 instants 里但正文已脱离页面。取最新一个仍挂在页面上的实例。
export function findBaijiahaoEditor(windowObject) {
  const instants = windowObject?.UE_V2?.instants ?? {}
  const usable = Object.entries(instants)
    .filter(([, editor]) => typeof editor?.getContent === 'function' && typeof editor?.setContent === 'function')
    .filter(([, editor]) => editor.body?.isConnected !== false && editor.iframe?.isConnected !== false)
    .sort(([a], [b]) => (Number(a.match(/\d+$/)?.[0] ?? -1) - Number(b.match(/\d+$/)?.[0] ?? -1)))
  return usable.at(-1)?.[1] ?? null
}

// 标题是富文本小编辑器，直接改 textContent 不会进它的状态；
// 先走 insertText（和用户输入同一路径），不生效再退回直接写入。
function writeBaijiahaoTitle(document, windowObject, titleControl, title) {
  const inserted = allowImporterInput(() => {
    if (typeof document.execCommand !== 'function') return false
    titleControl.focus({ preventScroll: true })
    const selection = windowObject.getSelection()
    const range = document.createRange()
    range.selectNodeContents(titleControl)
    selection.removeAllRanges()
    selection.addRange(range)
    try {
      return Boolean(document.execCommand('insertText', false, title))
    } catch {
      return false
    }
  })
  if (!inserted || readControlValue(titleControl).trim() !== title.trim()) {
    writeControl(windowObject, titleControl, title)
  }
}

export async function injectBaijiahao(document, article, windowObject = document.defaultView) {
  const titleControl = findBaijiahaoTitle(document)
  const editor = findBaijiahaoEditor(windowObject)
  if (!titleControl) throw new Error('百家号：未找到标题编辑器')
  if (!editor) throw new Error('百家号：未找到 UEditor 状态接口')

  const currentTitle = readControlValue(titleControl)
  const currentHtml = editor.getContent() ?? ''
  confirmPotentialOverwrite(
    windowObject,
    Boolean(currentTitle.trim() || hasMeaningfulEditorContent(parseHtml(document, currentHtml))),
  )

  editor.setContent(article.html)
  editor.fireEvent?.('contentChange')
  if (article.title) writeBaijiahaoTitle(document, windowObject, titleControl, article.title)
  return { platformId: 'baijiahao', titleFilled: Boolean(article.title), bodyFilled: true, mode: 'html-api' }
}
