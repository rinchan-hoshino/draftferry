import { isUsable, setControlValue, assertReadBack } from '../dom.js'
import { hostMatches } from './shared.js'

// DOM 与 Vue/Quill 取法来自 legacy/src/sohu.js 与 sohu-preflight.js。
// 搜狐正文是 Quill，只能从关联的 Vue 组件里拿到 Quill 实例；拿不到、或拿到的不是这个编辑器就直接停。
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

function ownDataProperty(object, name) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, name)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

// Vue 2 响应式数据：_data 上有 __ob__，并且 quill 是 getter/setter。
function reactiveQuillSlot(data) {
  if (!data || typeof data !== 'object' || !ownDataProperty(data, '__ob__')) return null
  let descriptor
  try {
    descriptor = Object.getOwnPropertyDescriptor(data, 'quill')
  } catch {
    return null
  }
  if (!descriptor || typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function') return null
  return { data, getter: descriptor.get }
}

// 沿编辑器祖先的 Vue 组件往上找唯一一个 quill 响应式槽位。
function collectQuillSlots(editor) {
  const slots = new Map()
  const seen = new Set()
  let element = editor
  for (let depth = 0; element && depth <= 32; depth += 1) {
    let component = ownDataProperty(element, '__vue__')
    for (let componentDepth = 0; component && componentDepth <= 40; componentDepth += 1) {
      if ((typeof component !== 'object' && typeof component !== 'function') || seen.has(component)) break
      seen.add(component)
      const slot = reactiveQuillSlot(ownDataProperty(component, '_data'))
      if (slot) slots.set(slot.data, slot)
      component = ownDataProperty(component, '$parent')
    }
    element = element.parentElement
  }
  return [...slots.values()]
}

// 只接受真正属于这个编辑器的 Quill：root 必须就是 .ql-editor，且 HTML 导入和整篇读写接口齐全。
function validatedQuillApi(candidate, editor) {
  const getContents = dataProperty(candidate, 'getContents')
  const getLength = dataProperty(candidate, 'getLength')
  const setContents = dataProperty(candidate, 'setContents')
  const clipboard = dataProperty(candidate, 'clipboard')
  const pasteHtml = dataProperty(clipboard, 'dangerouslyPasteHTML')
  if ([getContents, getLength, setContents, pasteHtml].some(fn => typeof fn !== 'function')) return null
  if (dataProperty(candidate, 'root') !== editor) return null
  return { quill: candidate, clipboard, getContents, setContents, pasteHtml }
}

function getSohuQuill(editor) {
  const slots = collectQuillSlots(editor)
  if (slots.length !== 1) return null
  try {
    return validatedQuillApi(slots[0].getter.call(slots[0].data), editor)
  } catch {
    return null
  }
}

function prepareSohuHtml(doc, html) {
  const container = doc.createElement('div')
  container.innerHTML = html
  // 搜狐粘贴会把 H3–H6 压平。正文 H1 通常已经当标题取走，所以正文的 H2/H3 映射到搜狐的 H1/H2。
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
    // 表格里的格式空白会被 Quill 变成段落，把表头和表体拆开，所以先删掉。
    for (const element of [table, ...table.querySelectorAll('thead, tbody, tfoot, tr, colgroup')]) {
      for (const node of [...element.childNodes]) {
        if (node.nodeType === 3 && node.nodeValue.trim() === '') node.remove()
      }
    }
  }
  return container.innerHTML
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
  findEditor(doc) {
    const editor = findSohuEditor(doc)
    if (!editor) throw new Error('未找到搜狐正文编辑器；请确认已进入文章编辑页')
    const api = getSohuQuill(editor)
    if (!api) throw new Error('无法从目标搜狐 Vue 组件取得关联的 Quill 编辑器实例')
    return {
      getText: () => editor.textContent ?? '',
      setHTML(html) {
        const prepared = prepareSohuHtml(doc, html)
        // 写入前拍快照，失败时把正文恢复到原样。
        const previous = structuredClone(api.getContents.call(api.quill))
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
