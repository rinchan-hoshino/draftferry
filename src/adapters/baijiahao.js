import { parseHtml, queryFirst, readControlValue, writeControl } from './common.js'
import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from '../editor-content.js'

export function findBaijiahaoTitle(document) {
  return queryFirst(document, [
    '.client_components_titleInput [contenteditable="true"]',
    '.client_pages_edit_components_titleInput [contenteditable="true"]',
    '[class*="titleInput"] [contenteditable="true"]',
  ])
}

export async function injectBaijiahao(document, article, windowObject = document.defaultView) {
  const titleControl = findBaijiahaoTitle(document)
  const editor = windowObject.UE_V2?.instants?.ueditorInstant0
  if (!titleControl) throw new Error('百家号：未找到标题编辑器')
  if (!editor || typeof editor.getContent !== 'function' || typeof editor.setContent !== 'function') {
    throw new Error('百家号：未找到 UEditor 状态接口')
  }

  const currentTitle = readControlValue(titleControl)
  const currentHtml = editor.getContent() ?? ''
  confirmPotentialOverwrite(
    windowObject,
    Boolean(currentTitle.trim() || hasMeaningfulEditorContent(parseHtml(document, currentHtml))),
  )

  editor.setContent(article.html)
  editor.fireEvent?.('contentChange')
  writeControl(windowObject, titleControl, article.title)
  return { platformId: 'baijiahao', titleFilled: Boolean(article.title), bodyFilled: true, mode: 'html-api' }
}

