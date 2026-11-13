const SAFE_TAGS = new Set([
  'html', 'head', 'body', 'main', 'article', 'section', 'aside', 'nav', 'header', 'footer',
  'div', 'span', 'p', 'a', 'br', 'hr', 'strong', 'em', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'form', 'label', 'input', 'textarea', 'select', 'option', 'button',
  'img', 'picture', 'source', 'video', 'audio', 'canvas', 'svg', 'iframe',
  'dialog', 'details', 'summary', 'template', 'slot', 'meta', 'link', 'style', 'script',
])

function safeTag(element) {
  const tag = element.tagName?.toLowerCase?.() ?? 'other'
  return SAFE_TAGS.has(tag) ? tag : 'other'
}

function classSignals(element) {
  let classes
  try {
    classes = [...element.classList].map((value) => value.toLowerCase())
  } catch {
    return []
  }
  const joined = classes.join(' ')
  const signals = []
  if (classes.includes('ql-editor')) signals.push('quill-editor')
  if (classes.includes('ql-container')) signals.push('quill-container')
  if (classes.includes('w-e-text')) signals.push('wang-editor')
  if (classes.includes('next-form-item')) signals.push('form-item')
  if (joined.includes('toolbar')) signals.push('toolbar')
  if (joined.includes('editor')) signals.push('contains-editor')
  if (joined.includes('content')) signals.push('contains-content')
  if (joined.includes('upload')) signals.push('contains-upload')
  return [...new Set(signals)].slice(0, 8)
}

function safeRect(element) {
  try {
    const Element = element.ownerDocument?.defaultView?.Element
    const descriptor = Object.getOwnPropertyDescriptor(Element?.prototype, 'getBoundingClientRect')
    if (!descriptor || typeof descriptor.value !== 'function') return null
    const rect = descriptor.value.call(element)
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  } catch {
    return null
  }
}

function editableCategory(element) {
  let value
  try {
    value = element.getAttribute('contenteditable')
  } catch {
    return 'absent'
  }
  if (value === null) return 'absent'
  if (value === '' || value === 'true') return 'true'
  if (value === 'false') return 'false'
  if (value === 'plaintext-only') return 'plaintext-only'
  return 'other'
}

function addRoot(queue, seenRoots, root, kind, maxRoots, state) {
  if (!root || seenRoots.has(root)) return
  if (queue.length >= maxRoots) {
    state.truncated = true
    return
  }
  seenRoots.add(root)
  queue.push({ root, kind })
}

export function collectSafeDomMap(document, options = {}) {
  const maxElements = options.maxElements ?? 5000
  const maxRoots = options.maxRoots ?? 32
  const queue = [{ root: document, kind: 'document' }]
  const seenRoots = new Set([document])
  const roots = []
  const state = {
    truncated: false,
    inaccessibleIframeCount: 0,
    elementCount: 0,
  }

  for (let rootIndex = 0; rootIndex < queue.length; rootIndex += 1) {
    if (state.elementCount >= maxElements) {
      state.truncated = true
      break
    }
    const { root, kind } = queue[rootIndex]
    const rootDocument = root.nodeType === 9 ? root : root.ownerDocument
    const NodeFilter = rootDocument?.defaultView?.NodeFilter
    if (!rootDocument || !NodeFilter) continue
    let walker
    try {
      walker = rootDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    } catch {
      continue
    }
    const elements = []
    const recordsByElement = new Map()
    let element
    while ((element = walker.nextNode())) {
      if (state.elementCount >= maxElements) {
        state.truncated = true
        break
      }
      const parent = recordsByElement.get(element.parentElement)
      const record = {
        index: state.elementCount,
        parentIndex: parent?.index ?? -1,
        depth: parent ? parent.depth + 1 : 0,
        tag: safeTag(element),
        childCount: element.children?.length ?? 0,
        contenteditable: editableCategory(element),
        hidden: Boolean(element.hidden || parent?.hidden),
        rect: safeRect(element),
        classSignals: classSignals(element),
      }
      recordsByElement.set(element, record)
      elements.push(record)
      state.elementCount += 1

      let shadowRoot
      try {
        shadowRoot = element.shadowRoot
      } catch {
        shadowRoot = null
      }
      if (shadowRoot) addRoot(queue, seenRoots, shadowRoot, 'shadowRoot', maxRoots, state)
      if (element.tagName !== 'IFRAME') continue
      try {
        const frameDocument = element.contentDocument
        if (frameDocument) {
          addRoot(queue, seenRoots, frameDocument, 'iframeDocument', maxRoots, state)
        } else {
          state.inaccessibleIframeCount += 1
        }
      } catch {
        state.inaccessibleIframeCount += 1
      }
    }
    roots.push({ kind, elements })
    if (state.truncated && state.elementCount >= maxElements) break
  }

  return {
    maxElements,
    maxRoots,
    elementCount: state.elementCount,
    rootCount: roots.length,
    inaccessibleIframeCount: state.inaccessibleIframeCount,
    truncated: state.truncated,
    roots,
  }
}
