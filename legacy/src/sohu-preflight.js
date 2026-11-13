const EMPTY_API_SHAPE = Object.freeze({
  stateSnapshot: false,
  lengthRead: false,
  stateRestore: false,
  htmlImport: false,
})

function ownDataProperty(object, name) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, name)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function dataProperty(object, name) {
  let current = object
  for (let depth = 0; current && depth < 8; depth += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, name)
      if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
      current = Object.getPrototypeOf(current)
    } catch {
      return undefined
    }
  }
  return undefined
}

function isVisibleEditor(editor) {
  if (editor.hidden || editor.closest('[hidden]')) return false
  const style = editor.ownerDocument.defaultView?.getComputedStyle(editor)
  return style?.display !== 'none' && style?.visibility !== 'hidden'
}

function reactiveSlot(data) {
  if (!data || typeof data !== 'object') return null
  const observer = ownDataProperty(data, '__ob__')
  if (!observer || typeof observer !== 'object') return null
  let descriptor
  try {
    descriptor = Object.getOwnPropertyDescriptor(data, 'quill')
  } catch {
    return null
  }
  if (
    !descriptor
    || typeof descriptor.get !== 'function'
    || typeof descriptor.set !== 'function'
  ) return null
  return { data, getter: descriptor.get }
}

function collectSlots(editor) {
  const slotsByData = new Map()
  const seenComponents = new Set()
  let ownerCount = 0
  let truncated = false
  let element = editor
  for (let ancestorDepth = 0; element && ancestorDepth <= 32; ancestorDepth += 1) {
    const owner = ownDataProperty(element, '__vue__')
    if (owner) {
      if (ownerCount >= 40) {
        truncated = true
      } else {
        ownerCount += 1
        let component = owner
        for (let componentDepth = 0; component && componentDepth <= 40; componentDepth += 1) {
          if (
            (typeof component !== 'object' && typeof component !== 'function')
            || seenComponents.has(component)
          ) break
          seenComponents.add(component)
          const slot = reactiveSlot(ownDataProperty(component, '_data'))
          if (slot) slotsByData.set(slot.data, slot)
          const parent = ownDataProperty(component, '$parent')
          if (componentDepth === 40 && parent && !seenComponents.has(parent)) {
            truncated = true
            break
          }
          component = parent
        }
      }
    }
    element = element.parentElement
  }
  if (element) truncated = true
  return {
    ownerCount,
    slots: [...slotsByData.values()],
    truncated,
  }
}

function apiShape(candidate) {
  const clipboard = dataProperty(candidate, 'clipboard')
  return {
    stateSnapshot: typeof dataProperty(candidate, 'getContents') === 'function',
    lengthRead: typeof dataProperty(candidate, 'getLength') === 'function',
    stateRestore: typeof dataProperty(candidate, 'setContents') === 'function',
    htmlImport: typeof dataProperty(clipboard, 'dangerouslyPasteHTML') === 'function',
  }
}

function rootRelation(candidate, editor) {
  const root = dataProperty(candidate, 'root')
  if (root === editor) return 'exact'
  const container = dataProperty(candidate, 'container')
  try {
    const Node = editor.ownerDocument.defaultView?.Node
    const nativeContains = dataProperty(Node?.prototype, 'contains')
    if (
      Node
      && container instanceof Node
      && typeof nativeContains === 'function'
      && nativeContains.call(container, editor)
    ) return 'container'
  } catch {
    // Fixed-category relation remains other/absent without invoking candidate code.
  }
  return root || container ? 'other' : 'absent'
}

function baseResult(version, editorCount) {
  return {
    schema: 1,
    draftferryVersion: version ?? 'unknown',
    operation: 'sohu-editor-preflight',
    editorCount,
    ownerCount: 0,
    slotCount: 0,
    getterStatus: 'not-run',
    apiShape: { ...EMPTY_API_SHAPE },
    rootRelation: 'absent',
    result: 'editor-missing',
    truncated: false,
  }
}

export function collectSohuEditorPreflight({ document, version } = {}) {
  const editors = [...(document?.querySelectorAll?.('.ql-editor[contenteditable="true"]') ?? [])]
    .filter(isVisibleEditor)
  const result = baseResult(version, editors.length)
  if (editors.length !== 1) {
    result.result = editors.length === 0 ? 'editor-missing' : 'editor-ambiguous'
    return result
  }

  const { ownerCount, slots, truncated } = collectSlots(editors[0])
  result.ownerCount = ownerCount
  result.slotCount = slots.length
  result.truncated = truncated
  if (truncated) {
    result.result = 'scan-truncated'
    return result
  }
  if (slots.length === 0) {
    result.result = 'slot-missing'
    return result
  }
  if (slots.length !== 1) {
    result.result = 'slot-ambiguous'
    return result
  }

  let candidate
  try {
    candidate = slots[0].getter.call(slots[0].data)
    result.getterStatus = 'returned'
  } catch {
    result.getterStatus = 'threw'
    result.result = 'getter-threw'
    return result
  }

  result.apiShape = apiShape(candidate)
  result.rootRelation = rootRelation(candidate, editors[0])
  if (!Object.values(result.apiShape).every(Boolean)) {
    result.result = 'api-shape-invalid'
  } else if (!['exact', 'container'].includes(result.rootRelation)) {
    result.result = 'root-mismatch'
  } else {
    result.result = 'validated'
  }
  return result
}
