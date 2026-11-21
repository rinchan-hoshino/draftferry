import { assertReadBack, isUsable, setControlValue } from '../dom.ts'
import type { PlatformAdapter } from '../types.ts'
import { hostMatches } from './shared.ts'

const TITLE_SELECTOR = 'input[placeholder*="标题"]'

export interface QuillApi {
  quill: Record<string, unknown>
  clipboard: Record<string, unknown>
  getContents: () => unknown
  setContents: (delta: unknown, source?: string) => void
  pasteHtml: (html: string, source?: string) => void
}

function findSohuEditor(doc: Document): HTMLElement | null {
  const editors = [...doc.querySelectorAll<HTMLElement>('.ql-editor')].filter(isUsable)
  const editable = editors.filter((editor) => editor.getAttribute('contenteditable') === 'true')
  const candidates = editable.length ? editable : editors
  return (
    candidates.sort((left, right) => {
      const l = left.getBoundingClientRect()
      const r = right.getBoundingClientRect()
      return r.width * r.height - l.width * l.height
    })[0] ?? null
  )
}

function safeRead(object: unknown, name: string): unknown {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined
  try {
    return (object as Record<string, unknown>)[name]
  } catch {
    return undefined
  }
}

function validatedQuillApi(candidate: unknown, editor: Element): QuillApi | null {
  if (!candidate || typeof candidate !== 'object') return null
  // Direct property read bypasses Tampermonkey unsafeWindow Proxy descriptor hiding
  const root = safeRead(candidate, 'root')
  const clipboard = safeRead(candidate, 'clipboard')
  const getContents = safeRead(candidate, 'getContents')
  const getLength = safeRead(candidate, 'getLength')
  const setContents = safeRead(candidate, 'setContents')
  const pasteHtml = safeRead(clipboard, 'dangerouslyPasteHTML')
  if (root !== editor) return null
  if ([getContents, getLength, setContents, pasteHtml].some((fn) => typeof fn !== 'function')) {
    return null
  }
  return {
    quill: candidate as Record<string, unknown>,
    clipboard: clipboard as Record<string, unknown>,
    getContents: getContents as () => unknown,
    setContents: setContents as (delta: unknown, source?: string) => void,
    pasteHtml: pasteHtml as (html: string, source?: string) => void,
  }
}

export function getSohuQuill(editor: Element): QuillApi | null {
  const found = new Set<Record<string, unknown>>()
  const seen = new Set<unknown>()
  let element: Element | null = editor
  for (let depth = 0; element && depth <= 16; depth += 1) {
    let component = safeRead(element, '__vue__')
    for (let compDepth = 0; component && compDepth <= 32; compDepth += 1) {
      if ((typeof component !== 'object' && typeof component !== 'function') || seen.has(component)) {
        break
      }
      seen.add(component)
      const data = safeRead(component, '_data')
      const candidate = safeRead(data, 'quill') ?? safeRead(component, 'quill')
      if (candidate) {
        const api = validatedQuillApi(candidate, editor)
        if (api) found.add(api.quill)
      }
      component = safeRead(component, '$parent')
    }
    element = element.parentElement
  }
  if (found.size !== 1) return null
  return validatedQuillApi([...found][0], editor)
}

export function prepareSohuHtml(doc: Document, html: string): string {
  const container = doc.createElement('div')
  container.innerHTML = html
  // Sohu paste flattens H3-H6; remap H2/H3 to H1/H2 when no H1 exists.
  const offset = container.querySelector('h1') ? 0 : 1
  for (const heading of container.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const level = Number(heading.tagName[1]) - offset
    const replacement = doc.createElement(level <= 2 ? `h${level}` : 'p')
    if (level <= 2) {
      replacement.append(...heading.childNodes)
    } else {
      const strong = doc.createElement('strong')
      strong.append(...heading.childNodes)
      replacement.append(strong)
    }
    heading.replaceWith(replacement)
  }
  for (const table of container.querySelectorAll('table')) {
    table.setAttribute('cellspacing', '0')
    table.style.setProperty('border-collapse', 'collapse', 'important')
    table.style.setProperty('border-spacing', '0px', 'important')
    // Strip whitespace text nodes inside tables to prevent Quill 2.0.3 splitting tables into paragraphs.
    for (const element of [
      table,
      ...table.querySelectorAll('thead, tbody, tfoot, tr, colgroup'),
    ]) {
      for (const node of [...element.childNodes]) {
        if (node.nodeType === 3 && (node.nodeValue ?? '').trim() === '') node.remove()
      }
    }
  }
  return container.innerHTML
}

function cloneDelta(win: Window, delta: unknown): unknown {
  try {
    const structuredCloneFn = (win as unknown as { structuredClone?: <T>(v: T) => T }).structuredClone
    if (typeof structuredCloneFn === 'function') return structuredCloneFn(delta)
  } catch {
    /* fallback to JSON clone for proxied objects */
  }
  return JSON.parse(JSON.stringify(delta))
}

const sohu: PlatformAdapter = {
  id: 'sohu',
  name: '搜狐号',
  hosts: ['mp.sohu.com'],
  match(url) {
    return (
      hostMatches(url, this.hosts) &&
      /^\/mpfe\/v4\/contentManagement\/news\/addarticle\/?$/.test(url.pathname)
    )
  },
  findTitle(doc) {
    return doc.querySelector<HTMLElement>(TITLE_SELECTOR)
  },
  findEditor(doc, win) {
    const editor = findSohuEditor(doc)
    if (!editor) throw new Error('未找到搜狐正文编辑器；请确认已进入文章编辑页')
    const api = getSohuQuill(editor)
    if (!api) throw new Error('无法从目标搜狐 Vue 组件取得关联的 Quill 编辑器实例')
    return {
      getText: () => editor.textContent ?? '',
      setHTML(html, { onProgress } = {}) {
        onProgress?.('写入正文…')
        const prepared = prepareSohuHtml(doc, html)
        const previous = cloneDelta(win, api.getContents.call(api.quill))
        try {
          api.pasteHtml.call(api.clipboard, prepared, 'user')
          assertReadBack(html, editor.textContent ?? '')
        } catch (error) {
          try {
            api.setContents.call(api.quill, previous, 'user')
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              '搜狐：写入失败且无法恢复原内容；请刷新页面且不要保存',
              { cause: restoreError },
            )
          }
          throw error
        }
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
}

export default sohu
