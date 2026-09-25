export function hasMeaningfulEditorContent(editor) {
  if (!editor) {
    return false
  }
  const clone = editor.cloneNode(true)
  for (const br of clone.querySelectorAll('br')) {
    br.remove()
  }
  if (clone.textContent?.trim()) {
    return true
  }

  for (const element of clone.querySelectorAll('*')) {
    const tagName = element.tagName.toLowerCase()
    const isEmptyScaffold = (
      ['div', 'p', 'span'].includes(tagName)
      && element.attributes.length === 0
    )
    if (!isEmptyScaffold) {
      return true
    }
  }
  return false
}

export const OVERWRITE_CONFIRM_MESSAGE = '当前文章已有内容，继续导入可能覆盖或合并现有内容，是否继续？'

export function confirmPotentialOverwrite(windowObject, hasExistingContent) {
  if (!hasExistingContent) return
  if (!windowObject.confirm(OVERWRITE_CONFIRM_MESSAGE)) {
    throw new Error('已取消导入')
  }
}

