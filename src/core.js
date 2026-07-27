import createDOMPurify from 'dompurify'
import { Marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const TITLE_SELECTOR = 'input[placeholder*="标题"]'
const EDITOR_SELECTOR = '.ql-editor'

const STYLE_RULES = {
  p: 'margin: 0 0 16px; line-height: 1.75; font-size: 16px; color: #2b2b2b;',
  h2: 'margin: 30px 0 14px; padding-left: 10px; border-left: 4px solid #d8a522; line-height: 1.4; font-size: 22px; font-weight: 700; color: #202020;',
  h3: 'margin: 24px 0 12px; line-height: 1.4; font-size: 19px; font-weight: 700; color: #242424;',
  h4: 'margin: 20px 0 10px; line-height: 1.4; font-size: 17px; font-weight: 700; color: #292929;',
  blockquote: 'margin: 18px 0; padding: 12px 16px; border-left: 4px solid #d9d9d9; background: #f7f7f7; color: #555; line-height: 1.7;',
  ul: 'margin: 0 0 16px; padding-left: 2em; line-height: 1.75;',
  ol: 'margin: 0 0 16px; padding-left: 2em; line-height: 1.75;',
  li: 'margin: 4px 0;',
  table: 'width: 100%; margin: 18px 0; border-collapse: collapse; table-layout: fixed; font-size: 15px;',
  th: 'padding: 9px 10px; border: 1px solid #cfcfcf; background: #f2f2f2; font-weight: 700; text-align: left; word-break: break-word;',
  td: 'padding: 9px 10px; border: 1px solid #cfcfcf; text-align: left; word-break: break-word;',
  pre: 'margin: 18px 0; padding: 14px 16px; overflow-x: auto; border-radius: 4px; background: #f5f5f5; line-height: 1.6; white-space: pre-wrap; word-break: break-word;',
  code: 'padding: 2px 5px; border-radius: 3px; background: #f2f2f2; color: #c7254e; font-family: Consolas, Monaco, monospace; font-size: 0.9em;',
  img: 'display: block; max-width: 100%; height: auto; margin: 18px auto;',
  hr: 'margin: 28px 0; border: 0; border-top: 1px solid #dedede;',
  a: 'color: #1677b3; text-decoration: underline;',
  strong: 'font-weight: 700;',
}

function normalizeLocalPath(path) {
  let normalized = path.trim().replaceAll('\\', '/')
  try {
    normalized = decodeURIComponent(normalized)
  } catch {
    // 保留原路径，让后面的明确错误提示负责反馈。
  }
  return normalized.replace(/^\.\//, '').replace(/^\/+/, '')
}

function isPortableImageSource(source) {
  return /^(?:https?:|data:image\/)/i.test(source)
}

function resolveWindow(windowObject) {
  const resolved = windowObject ?? globalThis.window
  if (!resolved?.document) {
    throw new Error('缺少浏览器 DOM 环境')
  }
  return resolved
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function createMarkedRenderer(mermaidSources) {
  return {
    code(token) {
      const language = (token.lang ?? '').trim().toLowerCase().split(/\s+/)[0]
      if (language !== 'mermaid') {
        const safeLanguage = language.replace(/[^a-z0-9_-]/g, '')
        return `<pre data-rin-code-language="${safeLanguage}"><code>${escapeHtml(token.text)}</code></pre>`
      }

      const index = mermaidSources.push(token.text) - 1
      return `<div data-rin-mermaid-index="${index}"></div>`
    },
  }
}

function applySohuStyles(container) {
  for (const [selector, cssText] of Object.entries(STYLE_RULES)) {
    for (const element of container.querySelectorAll(selector)) {
      element.setAttribute('style', cssText)
    }
  }

  for (const code of container.querySelectorAll('pre code')) {
    code.setAttribute(
      'style',
      'padding: 0; background: transparent; color: #333; font-family: Consolas, Monaco, monospace; font-size: 14px;',
    )
  }
}

async function replaceMermaidPlaceholders(container, mermaidSources, renderMermaid) {
  const placeholders = [...container.querySelectorAll('[data-rin-mermaid-index]')]
  for (const placeholder of placeholders) {
    const index = Number(placeholder.getAttribute('data-rin-mermaid-index'))
    const source = mermaidSources[index]
    const pngDataUrl = await renderMermaid(source, index)
    if (!/^data:image\/png;base64,/i.test(pngDataUrl)) {
      throw new Error(`第 ${index + 1} 个 Mermaid 图没有生成 PNG`)
    }

    const image = container.ownerDocument.createElement('img')
    image.setAttribute('src', pngDataUrl)
    image.setAttribute('alt', `Mermaid 流程图 ${index + 1}`)
    image.setAttribute('data-rin-mermaid', 'true')
    placeholder.replaceWith(image)
  }
}

function createPortableMarkdown(container) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  turndown.use(gfm)
  turndown.addRule('rin-fenced-code-language', {
    filter(node) {
      return node.nodeName === 'PRE' && node.hasAttribute('data-rin-code-language')
    },
    replacement(_content, node) {
      const language = node.getAttribute('data-rin-code-language') ?? ''
      const code = (node.textContent ?? '').replace(/\n$/, '')
      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`
    },
  })
  return turndown.turndown(container.innerHTML)
}

function replaceLocalImages(container, localImages) {
  for (const image of container.querySelectorAll('img')) {
    const source = image.getAttribute('src')?.trim() ?? ''
    if (isPortableImageSource(source)) {
      continue
    }

    if (!source) {
      throw new Error('文章中存在没有有效地址的图片')
    }

    const normalized = normalizeLocalPath(source)
    const byFullPath = localImages.get(normalized)
    const byFileName = localImages.get(normalized.split('/').at(-1))
    const replacement = byFullPath ?? byFileName
    if (!replacement) {
      throw new Error(`找不到本地图片：${source}`)
    }
    image.setAttribute('src', replacement)
  }
}

export async function renderMarkdownArticle(markdown, options = {}) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('Markdown 内容为空')
  }
  if (typeof options.renderMermaid !== 'function') {
    throw new Error('缺少 Mermaid PNG 转换器')
  }

  const windowObject = resolveWindow(options.windowObject)
  const mermaidSources = []
  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: createMarkedRenderer(mermaidSources),
  })
  const unsafeHtml = await marked.parse(markdown)
  const purify = createDOMPurify(windowObject)
  const safeHtml = purify.sanitize(unsafeHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'id', 'class'],
  })

  const container = windowObject.document.createElement('article')
  container.innerHTML = safeHtml

  const firstHeading = container.querySelector('h1')
  const title = firstHeading?.textContent?.trim() ?? ''
  firstHeading?.remove()

  const localImages = options.localImages ?? new Map()
  await replaceMermaidPlaceholders(
    container,
    mermaidSources,
    options.renderMermaid,
  )
  replaceLocalImages(container, localImages)
  applySohuStyles(container)

  return {
    title,
    html: container.innerHTML,
    portableMarkdown: createPortableMarkdown(container),
    mermaidCount: mermaidSources.length,
  }
}

export function hasMeaningfulEditorContent(editor) {
  if (!editor) {
    return false
  }
  const clone = editor.cloneNode(true)
  for (const br of clone.querySelectorAll('br')) {
    br.remove()
  }
  if (clone.textContent?.trim()) {
    return true
  }

  for (const element of clone.querySelectorAll('*')) {
    const tagName = element.tagName.toLowerCase()
    const isEmptyScaffold = (
      ['div', 'p', 'span'].includes(tagName)
      && element.attributes.length === 0
    )
    if (!isEmptyScaffold) {
      return true
    }
  }
  return false
}

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

function findSohuEditor(document) {
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

export const OVERWRITE_CONFIRM_MESSAGE = '当前文章已有内容，继续导入可能覆盖或合并现有内容，是否继续？'

export function confirmPotentialOverwrite(windowObject, hasExistingContent) {
  if (!hasExistingContent) return
  if (!windowObject.confirm(OVERWRITE_CONFIRM_MESSAGE)) {
    throw new Error('已取消导入')
  }
}

function isSohuQuill(candidate) {
  return Boolean(
    candidate
    && typeof candidate.getContents === 'function'
    && typeof candidate.setContents === 'function'
    && typeof candidate.clipboard?.dangerouslyPasteHTML === 'function'
  )
}

function getSohuQuill(windowObject, editor) {
  const candidates = []
  let node = editor
  for (let depth = 0; node && node !== editor.ownerDocument.body && depth < 5; depth += 1) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(node))) {
      if ('value' in descriptor && isSohuQuill(descriptor.value)) {
        candidates.push(descriptor.value)
      }
    }
    node = node.parentElement
  }

  const ownQuill = candidates.find(isSohuQuill)
  if (ownQuill) return ownQuill

  const container = editor.closest('.ql-container')
  const findQuill = windowObject.Quill?.find
  if (typeof findQuill === 'function') {
    for (const target of [editor, container]) {
      if (!target) continue
      try {
        candidates.push(findQuill.call(windowObject.Quill, target, true))
      } catch {
        // Some microfrontend Quill bridges reject nodes they do not own.
      }
    }
  }
  return candidates.find(isSohuQuill) ?? null
}

function selectSohuEditorContents(windowObject, editor) {
  const selection = windowObject.getSelection()
  const range = editor.ownerDocument.createRange()
  range.selectNodeContents(editor)
  selection.removeAllRanges()
  selection.addRange(range)
}

function imageCountInHtml(document, html) {
  const container = document.createElement('div')
  container.innerHTML = html
  return container.querySelectorAll('img').length
}

function assertSohuImagesPreserved(editor, expectedImageCount) {
  if (editor.querySelectorAll('img').length < expectedImageCount) {
    throw new Error('搜狐：导入后图片数量不完整；已停止，且不会保存或发布')
  }
}

async function pasteSohuHtml(windowObject, editor, html) {
  if (!windowObject.DataTransfer || !windowObject.ClipboardEvent) return false
  const expectedImageCount = imageCountInHtml(editor.ownerDocument, html)
  const transfer = new windowObject.DataTransfer()
  const plainText = editor.ownerDocument.createElement('div')
  plainText.innerHTML = html
  transfer.setData('text/html', html)
  transfer.setData('text/plain', plainText.textContent ?? '')
  selectSohuEditorContents(windowObject, editor)
  const before = editor.innerHTML
  const event = new windowObject.ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: transfer,
  })
  editor.dispatchEvent(event)
  await new Promise((resolve) => windowObject.setTimeout(resolve, 20))
  if (editor.innerHTML !== before) {
    if (editor.querySelectorAll('img').length >= expectedImageCount) return true
    const restored = editor.ownerDocument.execCommand?.('undo', false) === true
    if (!restored || editor.innerHTML !== before) {
      throw new Error('搜狐：原生粘贴丢失图片且无法安全切换插入方式')
    }
  }

  selectSohuEditorContents(windowObject, editor)
  const inserted = editor.ownerDocument.execCommand?.('insertHTML', false, html) === true
  if (!inserted || editor.innerHTML === before) return false
  editor.dispatchEvent(new windowObject.InputEvent('input', {
    bubbles: true,
    inputType: 'insertFromPaste',
    data: null,
  }))
  editor.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
  await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
  if (editor.innerHTML === before) return false
  assertSohuImagesPreserved(editor, expectedImageCount)
  return true
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

  const quill = getSohuQuill(windowObject, editor)
  const previousTitle = titleInput.value
  if (!quill) {
    const previousHtml = editor.innerHTML
    try {
      editor.focus()
      if (!await pasteSohuHtml(windowObject, editor, article.html)) {
        throw new Error('无法取得搜狐 Quill 编辑器实例，且原生粘贴或浏览器插入未被编辑器接管')
      }
      if (article.title) setInputValue(windowObject, titleInput, article.title)
    } catch (error) {
      try {
        if (titleInput.value !== previousTitle) {
          setInputValue(windowObject, titleInput, previousTitle)
        }
        if (editor.innerHTML !== previousHtml) {
          const restored = editor.ownerDocument.execCommand?.('undo', false) === true
          if (!restored || editor.innerHTML !== previousHtml) {
            throw new Error('原生粘贴回滚后正文不一致', { cause: error })
          }
        }
      } catch (rollbackError) {
        throw new Error(
          `搜狐：写入失败且无法恢复原内容；请刷新页面且不要保存；原错误：${error instanceof Error ? error.message : String(error)}`,
          { cause: rollbackError },
        )
      }
      throw error
    }
    return { titleFilled: Boolean(article.title), bodyFilled: true }
  }

  const previousDelta = cloneDelta(windowObject, quill.getContents())
  try {
    editor.focus()
    quill.clipboard.dangerouslyPasteHTML(article.html, 'user')
    assertSohuImagesPreserved(editor, imageCountInHtml(runtimeDocument, article.html))
    if (article.title) {
      setInputValue(windowObject, titleInput, article.title)
    }
  } catch (error) {
    try {
      if (titleInput.value !== previousTitle) {
        setInputValue(windowObject, titleInput, previousTitle)
      }
      quill.setContents(previousDelta, 'user')
    } catch (rollbackError) {
      throw new Error(
        `搜狐：写入失败且无法恢复原内容；原错误：${error instanceof Error ? error.message : String(error)}`,
        { cause: rollbackError },
      )
    }
    throw error
  }

  return { titleFilled: Boolean(article.title), bodyFilled: true }
}
