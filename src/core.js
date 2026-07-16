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

export function hasExistingSohuDraft(document) {
  const title = document.querySelector(TITLE_SELECTOR)?.value?.trim()
  const editor = document.querySelector(EDITOR_SELECTOR)
  return Boolean(title || hasMeaningfulEditorContent(editor))
}

const CANONICAL_TAGS = new Set([
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'img', 'li', 'ol', 'p', 'pre', 'strong', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

function normalizeText(text) {
  return text.replace(/\s+/g, ' ')
}

const STRUCTURAL_WHITESPACE_PARENTS = new Set([
  'root', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul', 'ol',
])
const TRIM_OUTER_TEXT_PARENTS = new Set([
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'p', 'td', 'th',
])

function isTextSignature(signature) {
  return signature?.[0] === 'text'
}

function normalizeSemanticChildren(children, parentTag) {
  let normalized = children.map((child) => (
    isTextSignature(child) ? ['text', child[1]] : child
  ))
  if (STRUCTURAL_WHITESPACE_PARENTS.has(parentTag)) {
    normalized = normalized.filter((child) => (
      !isTextSignature(child) || child[1].trim()
    ))
  }
  if (TRIM_OUTER_TEXT_PARENTS.has(parentTag) && normalized.length) {
    if (isTextSignature(normalized[0])) {
      normalized[0][1] = normalized[0][1].trimStart()
    }
    const last = normalized.at(-1)
    if (isTextSignature(last)) {
      last[1] = last[1].trimEnd()
    }
  }
  return normalized.filter((child) => (
    !isTextSignature(child) || child[1] !== ''
  ))
}

function canonicalTagName(element) {
  const tagName = element.tagName.toLowerCase()
  return { b: 'strong', i: 'em', s: 'del', strike: 'del' }[tagName] ?? tagName
}

function normalizedStyle(element) {
  return Array.from(
    { length: element.style.length },
    (_unused, index) => element.style.item(index),
  ).map((property) => [
      property,
      element.style.getPropertyValue(property).trim(),
      element.style.getPropertyPriority(property),
    ])
    .sort(([left], [right]) => left.localeCompare(right))
}

function semanticAttributes(element, tagName) {
  const names = new Set(['dir'])
  const byTag = {
    a: ['href'],
    blockquote: ['cite'],
    img: ['src', 'alt', 'width', 'height'],
    li: ['value'],
    ol: ['start', 'reversed', 'type'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
  }
  for (const name of byTag[tagName] ?? []) {
    names.add(name)
  }
  const attributes = [...names]
    .filter((name) => element.hasAttribute(name))
    .map((name) => [name, element.getAttribute(name)])
    .sort(([left], [right]) => left.localeCompare(right))
  const style = normalizedStyle(element)
  if (style.length) {
    attributes.push(['style', style])
  }
  return attributes
}

function semanticNode(node, preserveWhitespace = false) {
  if (node.nodeType === node.TEXT_NODE) {
    const rawText = (node.textContent ?? '').replaceAll('\r\n', '\n')
    const text = preserveWhitespace ? rawText : normalizeText(rawText)
    return text ? ['text', text] : null
  }
  if (node.nodeType !== node.ELEMENT_NODE) {
    return null
  }

  const tagName = canonicalTagName(node)
  const preserveChildrenWhitespace = preserveWhitespace || tagName === 'pre' || tagName === 'code'
  const attributes = semanticAttributes(node, tagName)
  const children = normalizeSemanticChildren(
    [...node.childNodes]
      .map((child) => semanticNode(child, preserveChildrenWhitespace))
      .filter(Boolean),
    tagName,
  )
  if (tagName === 'img') {
    return ['img', attributes]
  }
  if (tagName === 'a') {
    return ['a', attributes, children]
  }
  if (tagName === 'p' && children.length === 1 && children[0][0] === 'img') {
    return children[0]
  }
  if (!CANONICAL_TAGS.has(tagName)) {
    return children
  }
  return [tagName, attributes, children]
}

export function semanticSignature(container) {
  return JSON.stringify(normalizeSemanticChildren(
    [...container.childNodes].map(semanticNode).filter(Boolean),
    'root',
  ))
}

function assertEditorAcceptedArticle(document, editor, expectedHtml) {
  const expectedContainer = document.createElement('div')
  expectedContainer.innerHTML = expectedHtml
  if (semanticSignature(editor) !== semanticSignature(expectedContainer)) {
    throw new Error('搜狐编辑器改变了文章结构、顺序或图片内容')
  }
}

function getSohuQuill(windowObject, editor) {
  const container = editor.closest('.ql-container')
  const quill = container && windowObject.Quill?.find?.(container)
  if (
    !quill
    || typeof quill.getContents !== 'function'
    || typeof quill.setContents !== 'function'
    || typeof quill.clipboard?.dangerouslyPasteHTML !== 'function'
  ) {
    throw new Error('无法取得搜狐 Quill 编辑器实例；页面结构可能已经变化')
  }
  return quill
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

export async function injectSohuArticle(document, article) {
  const windowObject = document.defaultView
  const titleInput = document.querySelector(TITLE_SELECTOR)
  const editor = document.querySelector(EDITOR_SELECTOR)

  if (!titleInput) {
    throw new Error('未找到搜狐标题输入框；页面结构可能已经变化')
  }
  if (!editor) {
    throw new Error('未找到搜狐正文编辑器；请确认已进入文章编辑页')
  }
  if (typeof article?.html !== 'string' || !article.html.trim()) {
    throw new Error('没有可填入的正文内容')
  }
  if (hasExistingSohuDraft(document)) {
    throw new Error('当前标题或正文已有内容；为避免覆盖，请新建空白文章后再导入')
  }

  const quill = getSohuQuill(windowObject, editor)
  const previousDelta = cloneDelta(windowObject, quill.getContents())
  const previousTitle = titleInput.value
  const previousHtml = editor.innerHTML
  try {
    editor.focus()
    quill.clipboard.dangerouslyPasteHTML(article.html, 'user')

    if (!hasMeaningfulEditorContent(editor)) {
      throw new Error('搜狐编辑器没有接受转换后的内容')
    }
    assertEditorAcceptedArticle(document, editor, article.html)

    if (article.title) {
      setInputValue(windowObject, titleInput, article.title)
    }
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
    if (article.title && titleInput.value !== article.title) {
      throw new Error('搜狐在写入后改变了标题或正文')
    }
    try {
      assertEditorAcceptedArticle(document, editor, article.html)
    } catch {
      throw new Error('搜狐在写入后改变了标题或正文')
    }
  } catch (error) {
    try {
      if (titleInput.value !== previousTitle) {
        setInputValue(windowObject, titleInput, previousTitle)
      }
      quill.setContents(previousDelta, 'user')
      await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
      if (
        titleInput.value !== previousTitle
        || JSON.stringify(quill.getContents()) !== JSON.stringify(previousDelta)
      ) {
        throw new Error('标题或 Quill Delta 未恢复', { cause: error })
      }
      assertEditorAcceptedArticle(document, editor, previousHtml)
    } catch (rollbackError) {
      throw new Error(
        `搜狐：写入失败且回滚未通过验证，请刷新页面且不要保存；原错误：${error instanceof Error ? error.message : String(error)}`,
        { cause: rollbackError },
      )
    }
    throw error
  }

  return { titleFilled: Boolean(article.title), bodyFilled: true }
}
