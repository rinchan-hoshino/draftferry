import createDOMPurify from 'dompurify'
import { Marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

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

function applyArticleStyles(container) {
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
    const imageBlock = container.ownerDocument.createElement('p')
    imageBlock.append(image)
    placeholder.replaceWith(imageBlock)
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
  applyArticleStyles(container)

  return {
    title,
    html: container.innerHTML,
    portableMarkdown: createPortableMarkdown(container),
    mermaidCount: mermaidSources.length,
  }
}
