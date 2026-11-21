// 各平台共用的 DOM 与框架实例发现工具。页面窗口可能是油猴沙箱外的 unsafeWindow，
// 事件与构造函数均从 win 读取；框架属性支持直接读取，绕过 Tampermonkey Proxy 隐藏 descriptor。

export function queryFirst(doc, selectors) {
  for (const selector of selectors) {
    const element = doc.querySelector(selector)
    if (element) return element
  }
  return null
}

export function isUsable(element) {
  if (!element || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false
  const view = element.ownerDocument.defaultView
  for (let node = element; node && node.nodeType === 1; node = node.parentElement ?? node.getRootNode?.()?.host) {
    const style = view.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

export function readControl(control) {
  return ('value' in control ? control.value : control.textContent) ?? ''
}

export function setControlValue(win, control, value) {
  const proto = control instanceof win.HTMLTextAreaElement
    ? win.HTMLTextAreaElement.prototype
    : win.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(control, value)
  else control.value = value
  control.dispatchEvent(new win.Event('input', { bubbles: true }))
  control.dispatchEvent(new win.Event('change', { bubbles: true }))
  if (readControl(control) !== value) throw new Error('标题没有填进标题框，请手动粘贴标题')
}

export function setContentEditableText(win, control, text) {
  const doc = win.document
  control.focus?.({ preventScroll: true })
  const range = doc.createRange()
  range.selectNodeContents(control)
  const selection = win.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  let inserted
  try {
    inserted = Boolean(doc.execCommand('insertText', false, text))
  } catch {
    inserted = false
  }
  if (!inserted || control.textContent.trim() !== text.trim()) {
    control.textContent = text
    control.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
  if (control.textContent.trim() !== text.trim()) throw new Error('标题没有填进标题框，请手动粘贴标题')
}

export function writeTitleControl(win, control, title) {
  if ('value' in control) setControlValue(win, control, title)
  else setContentEditableText(win, control, title)
}

export const squash = text => (text ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;|\s+/g, '')

export function textLength(html) {
  return squash(html).length
}

export function assertReadBack(expectedHtml, actualHtml) {
  const expected = textLength(expectedHtml)
  const actual = textLength(actualHtml)
  if (actual < expected * 0.8) {
    throw new Error(`正文写入后读回长度不对（应有约 ${expected} 字，读到 ${actual} 字），已停下`)
  }
}

export function waitMs(win, ms) {
  return new Promise(resolve => win.setTimeout(resolve, ms))
}

export function collectOpenRoots(doc, limit = 100) {
  const roots = [doc]
  for (let index = 0; index < roots.length && roots.length < limit; index += 1) {
    for (const element of roots[index].querySelectorAll('*')) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot)
      if (element.tagName === 'IFRAME') {
        try {
          const frameDoc = element.contentDocument
          if (frameDoc && !roots.includes(frameDoc)) roots.push(frameDoc)
        } catch { /* 跨域 iframe 跳过 */ }
      }
      if (roots.length >= limit) break
    }
  }
  return roots
}

const PRIORITY_EDGES = [
  '$parent', '_data', 'ctx', 'current', 'data', 'editor', 'editorRef', 'exposed',
  'memoizedProps', 'memoizedState', 'next', 'parent', 'pendingProps', 'props',
  'proxy', 'quill', 'ref', 'return', 'setupState', 'stateNode', 'value',
]

const EXCLUDED_EDGES = new Set([
  'child', 'children', 'sibling', 'alternate', 'constructor', 'prototype', '__proto__',
  '_reactInternals', '_reactInternalFiber', '__reactInternalMemoizedMaskedChildContext',
])

const OWNER_KEY_PATTERN = /^(__vue__|__vueParentComponent|__reactFiber\$|__reactInternalInstance\$|__reactProps\$)/

function isTraversable(value, win) {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false
  try {
    if (value === win || value === win?.document) return false
    if (win?.Node && value instanceof win.Node) return false
  } catch {
    return false
  }
  return true
}

function readEdge(object, name) {
  try {
    const desc = Object.getOwnPropertyDescriptor(object, name)
    if (desc) return Object.hasOwn(desc, 'value') ? desc.value : undefined
  } catch { /* fallback to direct read */ }
  try {
    return object[name]
  } catch {
    return undefined
  }
}

// 有界遍历目标节点祖先上的 Vue 2/3 与 React 17/18 组件图，返回所有满足 match(obj) 的唯一实例。
export function scanFrameworkInstances(target, match, { maxAncestors = 8, maxDepth = 20, maxObjects = 240 } = {}) {
  const win = target.ownerDocument?.defaultView
  const found = []
  const foundSet = new Set()
  const seen = new Set()
  const queue = []

  let element = target
  for (let depth = 0; element && depth <= maxAncestors; depth += 1) {
    let keys = []
    try { keys = Object.getOwnPropertyNames(element) } catch { /* ignore */ }
    for (const key of new Set(['__vue__', '__vueParentComponent', ...keys])) {
      if (!OWNER_KEY_PATTERN.test(key)) continue
      const owner = readEdge(element, key)
      if (isTraversable(owner, win)) queue.push({ value: owner, depth: 0 })
    }
    element = element.parentElement
  }

  while (queue.length && seen.size < maxObjects) {
    const { value, depth } = queue.shift()
    if (!isTraversable(value, win) || seen.has(value)) continue
    seen.add(value)
    let matched = false
    try {
      matched = Boolean(match(value))
    } catch { /* ignore */ }
    if (matched) {
      if (!foundSet.has(value)) {
        foundSet.add(value)
        found.push(value)
      }
      continue
    }
    if (depth >= maxDepth) continue
    let ownKeys = []
    try { ownKeys = Object.getOwnPropertyNames(value).slice(0, 160) } catch { /* ignore */ }
    for (const key of new Set([...PRIORITY_EDGES, ...ownKeys])) {
      if (EXCLUDED_EDGES.has(key)) continue
      const next = readEdge(value, key)
      if (isTraversable(next, win) && !seen.has(next)) {
        queue.push({ value: next, depth: depth + 1 })
      }
    }
  }
  return found
}
