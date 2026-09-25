import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from './editor-content.js'
import { preservingFocus } from './editor-lock.js'

const TITLE_SELECTOR = 'input[placeholder*="标题"]'
const EDITOR_SELECTOR = '.ql-editor'

function isUsableSohuEditor(editor) {
  if (!editor || editor.closest('[hidden], [aria-hidden="true"]')) return false
  let node = editor
  while (node && node.nodeType === 1) {
    const style = editor.ownerDocument.defaultView.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    node = node.parentElement
  }
  return editor.getAttribute('contenteditable') !== 'false'
}

export function findSohuEditor(document) {
  const editors = [...document.querySelectorAll(EDITOR_SELECTOR)].filter(isUsableSohuEditor)
  const editable = editors.filter((editor) => editor.getAttribute('contenteditable') === 'true')
  const candidates = editable.length > 0 ? editable : editors
  return candidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()
    return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height)
  })[0] ?? null
}

export function hasExistingSohuDraft(document) {
  const title = document.querySelector(TITLE_SELECTOR)?.value?.trim()
  const editor = findSohuEditor(document)
  return Boolean(title || hasMeaningfulEditorContent(editor))
}

function dataProperty(object, name) {
  let current = object
  for (let depth = 0; current && depth < 6; depth += 1) {
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

function associatedSohuQuillApi(candidate, editor) {
  const getContents = dataProperty(candidate, 'getContents')
  const getLength = dataProperty(candidate, 'getLength')
  const setContents = dataProperty(candidate, 'setContents')
  if (
    typeof getContents !== 'function'
    || typeof getLength !== 'function'
    || typeof setContents !== 'function'
  ) return null

  let root
  let clipboard
  try {
    // Tampermonkey's page bridge can expose source-proven Quill fields through
    // direct reads while hiding their own-property descriptors from reflection.
    root = candidate.root
    clipboard = candidate.clipboard
  } catch {
    return null
  }
  const dangerouslyPasteHTML = dataProperty(clipboard, 'dangerouslyPasteHTML')
  if (root !== editor || typeof dangerouslyPasteHTML !== 'function') return null

  return {
    quill: candidate,
    clipboard,
    getContents,
    setContents,
    dangerouslyPasteHTML,
  }
}

function getVueReactiveQuillSlot(data) {
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

function getSohuQuill(editor) {
  const seenComponents = new Set()
  const slotsByData = new Map()
  let element = editor
  for (let ancestorDepth = 0; element && ancestorDepth <= 8; ancestorDepth += 1) {
    let component = ownDataProperty(element, '__vue__')
    for (let componentDepth = 0; component && componentDepth <= 20; componentDepth += 1) {
      if (
        (typeof component !== 'object' && typeof component !== 'function')
        || seenComponents.has(component)
      ) break
      seenComponents.add(component)
      const data = ownDataProperty(component, '_data')
      const slot = getVueReactiveQuillSlot(data)
      if (slot) slotsByData.set(slot.data, slot)
      component = ownDataProperty(component, '$parent')
    }
    element = element.parentElement
  }
  if (slotsByData.size !== 1) return null
  const [slot] = slotsByData.values()
  try {
    const candidate = slot.getter.call(slot.data)
    return associatedSohuQuillApi(candidate, editor)
  } catch {
    return null
  }
}

function prepareSohuHtml(document, html) {
  const container = document.createElement('div')
  container.innerHTML = html
  for (const table of container.querySelectorAll('table')) {
    table.setAttribute('cellspacing', '0')
    table.style.setProperty('border-collapse', 'collapse', 'important')
    table.style.setProperty('border-spacing', '0px', 'important')

    // Sohu's Quill 2.0.3 turns formatting whitespace inside a table into
    // paragraphs, which separates the header and body into different tables.
    const structuralElements = [
      table,
      ...table.querySelectorAll('thead, tbody, tfoot, tr, colgroup'),
    ]
    for (const element of structuralElements) {
      for (const node of [...element.childNodes]) {
        if (node.nodeType === 3 && node.nodeValue.trim() === '') node.remove()
      }
    }
  }
  return container.innerHTML
}

function cloneDelta(windowObject, delta) {
  if (typeof windowObject.structuredClone === 'function') {
    return windowObject.structuredClone(delta)
  }
  return JSON.parse(JSON.stringify(delta))
}

function setInputValue(windowObject, input, value, notify = true) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    windowObject.HTMLInputElement.prototype,
    'value',
  )?.set
  if (!valueSetter) {
    throw new Error('无法写入搜狐标题输入框')
  }
  valueSetter.call(input, value)
  if (notify) {
    input.dispatchEvent(new windowObject.Event('input', { bubbles: true }))
    input.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
  }
}

export async function injectSohuArticle(document, article, options = {}) {
  const windowObject = options.pageWindow ?? document.defaultView
  const runtimeDocument = windowObject.document ?? document
  const titleInput = runtimeDocument.querySelector(TITLE_SELECTOR)
  const editor = findSohuEditor(runtimeDocument)

  if (!titleInput) {
    throw new Error('未找到搜狐标题输入框；页面结构可能已经变化')
  }
  if (!editor) {
    throw new Error('未找到搜狐正文编辑器；请确认已进入文章编辑页')
  }
  if (typeof article?.html !== 'string' || !article.html.trim()) {
    throw new Error('没有可填入的正文内容')
  }
  confirmPotentialOverwrite(windowObject, hasExistingSohuDraft(runtimeDocument))
  const preparedHtml = prepareSohuHtml(runtimeDocument, article.html)

  const quillApi = getSohuQuill(editor)
  if (!quillApi) {
    throw new Error('无法从目标搜狐 Vue 组件取得关联的 Quill 编辑器实例')
  }
  const previousTitle = titleInput.value
  const previousDelta = cloneDelta(
    windowObject,
    quillApi.getContents.call(quillApi.quill),
  )
  try {
    preservingFocus(windowObject, () => {
      quillApi.dangerouslyPasteHTML.call(quillApi.clipboard, preparedHtml, 'user')
    })
    if (article.title) {
      setInputValue(windowObject, titleInput, article.title)
    }
  } catch (error) {
    const rollbackErrors = []
    if (titleInput.value !== previousTitle) {
      try {
        setInputValue(windowObject, titleInput, previousTitle)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    try {
      quillApi.setContents.call(quillApi.quill, previousDelta, 'user')
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `搜狐：写入失败且无法恢复原内容；请刷新页面且不要保存；原错误：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    throw error
  }

  return { titleFilled: Boolean(article.title), bodyFilled: true }
}
