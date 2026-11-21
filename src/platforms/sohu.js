import { isUsable, setControlValue, assertReadBack } from '../dom.js'
import { hostMatches } from './shared.js'

const TITLE_SELECTOR = 'input[placeholder*="标题"]'

function findSohuEditor(doc) {
  const editors = [...doc.querySelectorAll('.ql-editor')].filter(isUsable)
  const editable = editors.filter(editor => editor.getAttribute('contenteditable') === 'true')
  const candidates = editable.length ? editable : editors
  return candidates.sort((left, right) => {
    const l = left.getBoundingClientRect()
    const r = right.getBoundingClientRect()
    return (r.width * r.height) - (l.width * l.height)
  })[0] ?? null
}

function safeRead(object, name) {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined
  try {
    return object[name]
  } catch {
    return undefined
  }
}

function validatedQuillApi(candidate, editor) {
  if (!candidate || typeof candidate !== 'object') return null
  // 直接属性读取兼容 Tampermonkey unsafeWindow Proxy，避免 getOwnPropertyDescriptor 返回 undefined。
  const root = safeRead(candidate, 'root')
  const clipboard = safeRead(candidate, 'clipboard')
  const getContents = safeRead(candidate, 'getContents')
  const getLength = safeRead(candidate, 'getLength')
  const setContents = safeRead(candidate, 'setContents')
  const pasteHtml = safeRead(clipboard, 'dangerouslyPasteHTML')
  if (root !== editor) return null
  if ([getContents, getLength, setContents, pasteHtml].some(fn => typeof fn !== 'function')) return null
  return { quill: candidate, clipboard, getContents, setContents, pasteHtml }
}

export function getSohuQuill(editor) {
  const found = new Set()
  const seen = new Set()
  let element = editor
  for (let depth = 0; element && depth <= 16; depth += 1) {
    let component = safeRead(element, '__vue__')
    for (let compDepth = 0; component && compDepth <= 32; compDepth += 1) {
      if ((typeof component !== 'object' && typeof component !== 'function') || seen.has(component)) break
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

export function prepareSohuHtml(doc, html) {
  const container = doc.createElement('div')
  container.innerHTML = html
  // 搜狐粘贴会把 H3–H6 压平。正文 H1 通常已取作标题，无 H1 时将 H2/H3 降级映射为 H1/H2。
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
    // 清理表格内空白文本节点，防 Quill 2.0.3 将空白变成段落导致拆表。
    for (const element of [table, ...table.querySelectorAll('thead, tbody, tfoot, tr, colgroup')]) {
      for (const node of [...element.childNodes]) {
        if (node.nodeType === 3 && node.nodeValue.trim() === '') node.remove()
      }
    }
  }
  return container.innerHTML
}

function cloneDelta(win, delta) {
  try {
    if (typeof win.structuredClone === 'function') return win.structuredClone(delta)
  } catch { /* fallback to JSON clone for proxied objects */ }
  return JSON.parse(JSON.stringify(delta))
}

export default {
  id: 'sohu',
  name: '搜狐号',
  hosts: ['mp.sohu.com'],
  match(url) {
    return hostMatches(url, this.hosts) && /^\/mpfe\/v4\/contentManagement\/news\/addarticle\/?$/.test(url.pathname)
  },
  findTitle(doc) {
    return doc.querySelector(TITLE_SELECTOR)
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
            throw new AggregateError([error, restoreError], '搜狐：写入失败且无法恢复原内容；请刷新页面且不要保存', { cause: restoreError })
          }
          throw error
        }
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
}
