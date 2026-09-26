import { parseHtml, readControlValue, writeControl, selectEditorEnd } from './common.js'
import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from '../editor-content.js'
import { preservingFocus } from '../editor-lock.js'

function prepareToutiaoPastedHtml(document, html) {
  const container = parseHtml(document, html)
  for (const image of container.querySelectorAll('img')) {
    image.setAttribute('needCheck', 'true')
    image.setAttribute('paste', 'true')
  }
  return container.innerHTML
}

export async function injectToutiao(document, article, windowObject = document.defaultView) {
  const titleControl = document.querySelector('textarea[placeholder*="标题"]')
  const editor = document.querySelector('.ProseMirror[contenteditable="true"], .ProseMirror')
  if (!titleControl || !editor) throw new Error('今日头条：未找到标题或正文编辑器')
  confirmPotentialOverwrite(
    windowObject,
    Boolean(readControlValue(titleControl).trim() || hasMeaningfulEditorContent(editor)),
  )
  if (typeof document.execCommand !== 'function') {
    throw new Error('今日头条：浏览器不支持 insertHTML 编辑命令')
  }
  const pastedHtml = prepareToutiaoPastedHtml(document, article.html)
  const accepted = preservingFocus(windowObject, () => {
    editor.focus({ preventScroll: true })
    selectEditorEnd(windowObject, editor)
    return Boolean(document.execCommand('insertHTML', false, pastedHtml))
  })
  if (!accepted) throw new Error('今日头条：编辑器拒绝 insertHTML')
  editor.dispatchEvent(new windowObject.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }))
  editor.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
  writeControl(windowObject, titleControl, article.title)
  return { platformId: 'toutiao', titleFilled: Boolean(article.title), bodyFilled: true, mode: 'html-command' }
}

