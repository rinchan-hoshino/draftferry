// Shared DOM and framework instance discovery utilities.
// pageWindow may be Tampermonkey's unsafeWindow; constructors and events are read from `win`.

export function queryFirst<T extends Element = HTMLElement>(
  doc: ParentNode,
  selectors: readonly string[],
): T | null {
  for (const selector of selectors) {
    const element = doc.querySelector<T>(selector)
    if (element) return element
  }
  return null
}

export function isUsable(element: Element | null): boolean {
  if (!element || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false
  const view = element.ownerDocument.defaultView
  if (!view) return false
  let node: Element | null = element
  while (node && node.nodeType === 1) {
    const style = view.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const parent: HTMLElement | null = node.parentElement
    if (parent) {
      node = parent
    } else {
      const root = node.getRootNode?.()
      node = root && 'host' in root ? (root as ShadowRoot).host : null
    }
  }
  return true
}

export function readControl(control: Element): string {
  if ('value' in control && typeof (control as HTMLInputElement).value === 'string') {
    return (control as HTMLInputElement).value
  }
  return control.textContent ?? ''
}

export function setControlValue(win: Window, control: HTMLElement, value: string): void {
  const winTyped = win as unknown as {
    HTMLTextAreaElement: typeof HTMLTextAreaElement
    HTMLInputElement: typeof HTMLInputElement
    Event: typeof Event
  }
  const proto =
    control instanceof winTyped.HTMLTextAreaElement
      ? winTyped.HTMLTextAreaElement.prototype
      : winTyped.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(control, value)
  else (control as HTMLInputElement).value = value
  control.dispatchEvent(new winTyped.Event('input', { bubbles: true }))
  control.dispatchEvent(new winTyped.Event('change', { bubbles: true }))
  if (readControl(control) !== value) {
    throw new Error('标题没有填进标题框，请手动粘贴标题')
  }
}

export function setContentEditableText(win: Window, control: HTMLElement, text: string): void {
  const doc = win.document
  const winTyped = win as unknown as { InputEvent: typeof InputEvent }
  control.focus?.({ preventScroll: true })
  const range = doc.createRange()
  range.selectNodeContents(control)
  const selection = win.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  let inserted = false
  try {
    inserted = Boolean(doc.execCommand('insertText', false, text))
  } catch {
    /* fallback below */
  }
  if (!inserted || (control.textContent ?? '').trim() !== text.trim()) {
    control.textContent = text
    control.dispatchEvent(
      new winTyped.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    )
  }
  if ((control.textContent ?? '').trim() !== text.trim()) {
    throw new Error('标题没有填进标题框，请手动粘贴标题')
  }
}

export function writeTitleControl(win: Window, control: HTMLElement, title: string): void {
  if ('value' in control) setControlValue(win, control, title)
  else setContentEditableText(win, control, title)
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(?:lt|gt|amp|quot|apos);/gi, (entity) => {
      switch (entity.toLowerCase()) {
        case '&lt;':
          return '<'
        case '&gt;':
          return '>'
        case '&quot;':
          return '"'
        case '&apos;':
          return "'"
        default:
          return '&'
      }
    })
}

export const squash = (text: string | null | undefined): string =>
  decodeBasicEntities((text ?? '').replace(/<[^>]*>/g, '')).replace(/\s+/g, '')

export function textLength(html: string): number {
  return squash(html).length
}

export function assertReadBack(expectedHtml: string, actualHtml: string): void {
  const expected = textLength(expectedHtml)
  const actual = textLength(actualHtml)
  if (actual < expected * 0.8) {
    throw new Error(`正文写入后读回长度不对（应有约 ${expected} 字，读到 ${actual} 字），已停下`)
  }
}

export function waitMs(win: Window, ms: number): Promise<void> {
  return new Promise((resolve) => {
    win.setTimeout(resolve, ms)
  })
}

export function collectOpenRoots(doc: Document, limit = 100): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [doc]
  for (let index = 0; index < roots.length && roots.length < limit; index += 1) {
    for (const element of roots[index].querySelectorAll('*')) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) {
        roots.push(element.shadowRoot)
      }
      if (element.tagName === 'IFRAME') {
        try {
          const frameDoc = (element as HTMLIFrameElement).contentDocument
          if (frameDoc && !roots.includes(frameDoc)) roots.push(frameDoc)
        } catch {
          /* cross-origin iframe skipped */
        }
      }
      if (roots.length >= limit) break
    }
  }
  return roots
}

const PRIORITY_EDGES = [
  '$parent',
  '_data',
  'ctx',
  'current',
  'data',
  'editor',
  'editorRef',
  'exposed',
  'memoizedProps',
  'memoizedState',
  'next',
  'parent',
  'pendingProps',
  'props',
  'proxy',
  'quill',
  'ref',
  'return',
  'setupState',
  'stateNode',
  'value',
] as const

const EXCLUDED_EDGES = new Set([
  'child',
  'children',
  'sibling',
  'alternate',
  'constructor',
  'prototype',
  '__proto__',
  '_reactInternals',
  '_reactInternalFiber',
  '__reactInternalMemoizedMaskedChildContext',
])

const OWNER_KEY_PATTERN =
  /^(__vue__|__vueParentComponent|__reactFiber\$|__reactInternalInstance\$|__reactProps\$)/

function isTraversable(value: unknown, win: Window | null): value is Record<string, unknown> {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false
  try {
    if (value === win || value === win?.document) return false
    const winNode = (win as unknown as { Node?: typeof Node } | null)?.Node
    if (winNode && value instanceof winNode) return false
  } catch {
    return false
  }
  return true
}

function readEdge(object: Record<string, unknown>, name: string): unknown {
  try {
    const desc = Object.getOwnPropertyDescriptor(object, name)
    if (desc) return Object.hasOwn(desc, 'value') ? desc.value : undefined
  } catch {
    /* fallback to direct read */
  }
  try {
    return object[name]
  } catch {
    return undefined
  }
}

export interface ScanOptions {
  maxAncestors?: number
  maxDepth?: number
  maxObjects?: number
}

// Bounded BFS over Vue 2/3 & React 17/18 component graphs on ancestor nodes.
export function scanFrameworkInstances<T = Record<string, unknown>>(
  target: Element,
  match: (obj: Record<string, unknown>) => boolean,
  { maxAncestors = 8, maxDepth = 20, maxObjects = 240 }: ScanOptions = {},
): T[] {
  const win = target.ownerDocument?.defaultView ?? null
  const found: T[] = []
  const foundSet = new Set<unknown>()
  const seen = new Set<unknown>()
  const queue: Array<{ value: Record<string, unknown>; depth: number }> = []

  let element: Element | null = target
  for (let depth = 0; element && depth <= maxAncestors; depth += 1) {
    let keys: string[] = []
    try {
      keys = Object.getOwnPropertyNames(element)
    } catch {
      /* ignore */
    }
    for (const key of new Set(['__vue__', '__vueParentComponent', ...keys])) {
      if (!OWNER_KEY_PATTERN.test(key)) continue
      const owner = readEdge(element as unknown as Record<string, unknown>, key)
      if (isTraversable(owner, win)) queue.push({ value: owner, depth: 0 })
    }
    element = element.parentElement
  }

  while (queue.length && seen.size < maxObjects) {
    const item = queue.shift()!
    const { value, depth } = item
    if (!isTraversable(value, win) || seen.has(value)) continue
    seen.add(value)
    let matched = false
    try {
      matched = Boolean(match(value))
    } catch {
      /* ignore */
    }
    if (matched) {
      if (!foundSet.has(value)) {
        foundSet.add(value)
        found.push(value as T)
      }
      continue
    }
    if (depth >= maxDepth) continue
    let ownKeys: string[] = []
    try {
      ownKeys = Object.getOwnPropertyNames(value).slice(0, 160)
    } catch {
      /* ignore */
    }
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
