export function inspectOpenEditorRoots(document, limit = 100) {
  const entries = [{ root: document, kind: 'document' }]
  const seen = new Set([document])
  let inaccessibleIframeCount = 0
  let truncated = false

  const addRoot = (root, kind) => {
    if (!root || seen.has(root)) return
    if (entries.length >= limit) {
      truncated = true
      return
    }
    seen.add(root)
    entries.push({ root, kind })
  }

  for (let index = 0; index < entries.length; index += 1) {
    const { root } = entries[index]
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) addRoot(element.shadowRoot, 'shadowRoot')
      if (element.tagName !== 'IFRAME') continue
      try {
        const frameDocument = element.contentDocument
        if (frameDocument) addRoot(frameDocument, 'iframeDocument')
        else inaccessibleIframeCount += 1
      } catch {
        inaccessibleIframeCount += 1
      }
    }
  }

  return { entries, inaccessibleIframeCount, truncated }
}

export function collectOpenEditorRoots(document, limit) {
  return inspectOpenEditorRoots(document, limit).entries.map(({ root }) => root)
}
