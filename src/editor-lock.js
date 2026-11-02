const activeEditors = new WeakSet()
let importerInputDepth = 0
const blockedEvents = [
  'beforeinput', 'paste', 'cut', 'drop', 'dragstart',
  'keydown', 'pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick',
]

function isNavigationKey(event) {
  if (event.key === 'Tab' || event.key === 'Escape') return true
  return (event.ctrlKey || event.metaKey)
    && ['a', 'c', 'f', 'l', 'p', 'r', 't', 'w', 'n', '+', '-', '0'].includes(event.key.toLowerCase())
}

// Only trusted user edits are blocked. Platform APIs and the importer can still
// update their own models, without disabling the rest of the page or clipboard.
export async function withEditorLock(elements, operation, options = {}) {
  const targets = [...new Set(elements.filter(Boolean))]
  if (targets.some((element) => activeEditors.has(element))) {
    throw new Error('当前编辑器正在导入，请稍候')
  }
  const pageWindow = options.pageWindow ?? targets[0]?.ownerDocument.defaultView
  const initialUrl = pageWindow?.location.href
  const assertTargetCurrent = () => {
    if (pageWindow?.location.href !== initialUrl
      || targets.some((element) => !element.isConnected)) {
      throw new Error('页面或编辑器已切换，已停止导入；请在目标页面重新选择文件')
    }
  }
  const assertCurrent = () => {
    assertTargetCurrent()
    if (options.signal?.aborted) throw new DOMException('已停止导入', 'AbortError')
  }
  assertCurrent()
  const windows = new Set(targets.map((element) => element.ownerDocument.defaultView))
  const previous = targets.map((element) => ({
    element,
    busy: element.getAttribute('aria-busy'),
    editable: element.getAttribute('contenteditable'),
    tabIndex: element.getAttribute('tabindex'),
    readOnly: 'readOnly' in element ? element.readOnly : null,
  }))
  const block = (event) => {
    if (importerInputDepth > 0) return
    if (!event.isTrusted || (event.type === 'keydown' && isNavigationKey(event))) return
    const path = event.composedPath()
    const target = targets.find((element) => path.includes(element))
    if (!target) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === 'pointerdown') {
      // A click on a locked editor must not leave subsequent typing directed
      // at the unrelated field that happened to have focus before the click.
      target.focus({ preventScroll: true })
    }
  }
  for (const element of targets) {
    activeEditors.add(element)
    element.setAttribute('aria-busy', 'true')
    if ('readOnly' in element) element.readOnly = true
    if (options.freezeContentEditable && element.getAttribute('contenteditable') === 'true') {
      element.setAttribute('contenteditable', 'false')
      element.setAttribute('tabindex', '0')
    }
  }
  for (const windowObject of windows) {
    for (const type of blockedEvents) {
      windowObject.addEventListener(type, block, { capture: true, passive: false })
    }
  }
  try {
    return await operation(assertCurrent, assertTargetCurrent)
  } finally {
    for (const windowObject of windows) {
      for (const type of blockedEvents) windowObject.removeEventListener(type, block, true)
    }
    for (const { element, busy, editable, tabIndex, readOnly } of previous) {
      activeEditors.delete(element)
      if (busy === null) element.removeAttribute('aria-busy')
      else element.setAttribute('aria-busy', busy)
      if (readOnly !== null) element.readOnly = readOnly
      if (options.freezeContentEditable && editable !== null) {
        element.setAttribute('contenteditable', editable)
        if (tabIndex === null) element.removeAttribute('tabindex')
        else element.setAttribute('tabindex', tabIndex)
      }
    }
  }
}

// execCommand produces trusted beforeinput events; let the importer's own
// synchronous edits through while the lock keeps blocking the user.
export function allowImporterInput(operation) {
  importerInputDepth += 1
  try {
    return operation()
  } finally {
    importerInputDepth -= 1
  }
}

// A synchronous editor API can move selection even when focus() is not called.
// Snapshot at the moment of the write so an unrelated field edited during an
// upload keeps its current selection, rather than the selection at job start.
export function preservingFocus(windowObject, operation) {
  const document = windowObject.document
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  const selection = windowObject.getSelection()
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, index) => (
    selection.getRangeAt(index).cloneRange()
  ))
  const textSelection = typeof active?.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null
  const scroll = [windowObject.scrollX, windowObject.scrollY]
  try {
    return operation()
  } finally {
    if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) {
        if (range.commonAncestorContainer.isConnected) selection.addRange(range)
      }
    }
    if (textSelection && active?.isConnected) active.setSelectionRange(...textSelection)
    if (windowObject.scrollX !== scroll[0] || windowObject.scrollY !== scroll[1]) {
      windowObject.scrollTo(...scroll)
    }
  }
}
