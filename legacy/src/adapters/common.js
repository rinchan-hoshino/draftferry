import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from '../editor-content.js'

export function queryFirst(document, selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      return element
    }
  }
  return null
}

export function readControlValue(control) {
  if ('value' in control) {
    return control.value
  }
  return control.textContent ?? ''
}

function nativeValueSetter(windowObject, control) {
  if (control instanceof windowObject.HTMLTextAreaElement) {
    return Object.getOwnPropertyDescriptor(
      windowObject.HTMLTextAreaElement.prototype,
      'value',
    )?.set
  }
  if (control instanceof windowObject.HTMLInputElement) {
    return Object.getOwnPropertyDescriptor(
      windowObject.HTMLInputElement.prototype,
      'value',
    )?.set
  }
  return null
}

export function writeControl(windowObject, control, value, notify = true) {
  const setter = nativeValueSetter(windowObject, control)
  if (setter) {
    setter.call(control, value)
  } else if ('value' in control) {
    control.value = value
  } else {
    control.textContent = value
  }
  if (notify) {
    control.dispatchEvent(new windowObject.Event('input', { bubbles: true }))
    control.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
  }
}

export function readBodyValue(editor) {
  if ('value' in editor) {
    return editor.value
  }
  return editor.textContent ?? ''
}

export function writeBodyValue(windowObject, editor, value, notify = true) {
  const setter = nativeValueSetter(windowObject, editor)
  if (setter) {
    setter.call(editor, value)
  } else if ('value' in editor) {
    editor.value = value
  } else {
    editor.textContent = value
  }
  if (notify) {
    editor.dispatchEvent(new windowObject.Event('input', { bubbles: true }))
    editor.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
  }
}

export function confirmTextEditorOverwrite(windowObject, titleControl, bodyEditor) {
  const bodyHasContent = 'value' in bodyEditor
    ? readBodyValue(bodyEditor).trim() !== ''
    : hasMeaningfulEditorContent(bodyEditor)
  confirmPotentialOverwrite(
    windowObject,
    Boolean(readControlValue(titleControl).trim() || bodyHasContent),
  )
}

export function parseHtml(document, html) {
  const container = document.createElement('div')
  container.innerHTML = html
  return container
}

export function selectEditorEnd(windowObject, editor) {
  const selection = windowObject.getSelection()
  const range = windowObject.document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

