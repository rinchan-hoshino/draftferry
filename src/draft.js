import createDOMPurify from 'dompurify'
import { Marked } from 'marked'

const sanitizing = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'style'],
  FORBID_ATTR: ['style', 'id', 'class'],
}

export function normalizeImagePath(source) {
  let path = source.trim().replaceAll('\\', '/')
  try { path = decodeURIComponent(path) } catch { /* Keep malformed paths visible. */ }
  return path.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
}

export function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function imageKind(source) {
  if (/^(?:https?:)?\/\//i.test(source)) return 'remote'
  if (/^data:image\//i.test(source)) return 'embedded'
  return 'local'
}

function cleanLink(windowObject, purify, source) {
  const decoder = windowObject.document.createElement('textarea')
  let decoded = source
  for (let depth = 0; depth < 5; depth++) {
    decoder.innerHTML = decoded
    if (decoder.value === decoded) break
    decoded = decoder.value
    if (depth === 4) return null
  }
  const node = windowObject.document.createElement('div')
  node.innerHTML = purify.sanitize(`<a href="${escapeHtml(decoded)}"></a>`, sanitizing)
  return node.firstElementChild?.getAttribute('href') ?? null
}

// Parse once: both exports consume the same semantic tokens.
export function createDraft(markdown, { windowObject, filename = '未命名稿件.md' } = {}) {
  if (typeof markdown !== 'string' || !markdown.trim()) throw new Error('Markdown 内容为空')
  if (!windowObject?.document) throw new Error('缺少浏览器 DOM 环境')
  const marked = new Marked({ gfm: true, breaks: false })
  const tokens = marked.lexer(markdown)
  const purify = createDOMPurify(windowObject)
  const assets = []
  const bySource = new Map()
  let title = ''
  let mermaidCount = 0
  let titleToken
  const addImage = (source, label) => {
    source = source?.trim() ?? ''
    if (!source) throw new Error('文章中存在没有有效地址的图片')
    const kind = imageKind(source)
    const key = kind === 'local' ? normalizeImagePath(source) : source
    if (!bySource.has(key)) {
      const id = `asset-${assets.length + 1}`
      bySource.set(key, id)
      assets.push({ id, kind, source, name: kind === 'local' ? key : label || `图片 ${assets.length + 1}` })
    }
    return bySource.get(key)
  }
  marked.walkTokens(tokens, token => {
    if (token.type === 'heading' && token.depth === 1 && !titleToken) {
      titleToken = token
      token.draftTitle = true
      const node = windowObject.document.createElement('div')
      node.innerHTML = purify.sanitize(marked.parser([token], marked.defaults), sanitizing)
      title = node.textContent.trim()
    }
    if (token.type === 'image') token.assetId = addImage(token.href, token.text)
    if (token.type === 'link') {
      const href = cleanLink(windowObject, purify, token.href)
      token.omitLink = !href
      token.href = href ?? ''
    }
    if (token.type === 'code' && /^mermaid(?:\s|$)/i.test(token.lang?.trim() ?? '')) {
      mermaidCount++
      token.assetId = `asset-${assets.length + 1}`
      assets.push({ id: token.assetId, kind: 'mermaid', source: token.text, name: `Mermaid 图表 ${mermaidCount}`, index: mermaidCount - 1 })
    }
    if (token.type === 'html') {
      const node = windowObject.document.createElement('div')
      node.innerHTML = purify.sanitize(token.text, sanitizing)
      for (const image of node.querySelectorAll('img')) addImage(image.getAttribute('src'), image.alt)
    }
  })
  return { filename, title, tokens, titleToken, assets, mermaidCount, windowObject, purify }
}

function imageSource(draft, prepared, id) {
  const value = prepared.get(id)
  if (value) return value
  const asset = draft.assets.find(asset => asset.id === id)
  if (asset?.kind === 'remote' || asset?.kind === 'embedded') return asset.source
  throw new Error(`尚未准备图片：${asset?.name ?? id}`)
}

function safeHtml(draft, html, prepared) {
  const container = draft.windowObject.document.createElement('div')
  container.innerHTML = draft.purify.sanitize(html, sanitizing)
  for (const link of container.querySelectorAll('a[href]')) {
    const href = cleanLink(draft.windowObject, draft.purify, link.getAttribute('href'))
    if (href === null) link.removeAttribute('href')
    else link.setAttribute('href', href)
  }
  for (const image of container.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? ''
    const asset = draft.assets.find(asset => asset.source === source)
    if (asset) image.setAttribute('src', imageSource(draft, prepared, asset.id))
  }
  return container.innerHTML
}

function markdownImage(label, source, title) {
  const alt = label.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
  const suffix = title ? ` "${title.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : ''
  return `![${alt}](${source.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29')}${suffix})`
}

function markdownExport(draft, prepared) {
  const inline = tokens => {
    let suppressedTag
    return (tokens ?? []).map(token => {
      if (suppressedTag) {
        if (token.type === 'html' && token.text.toLowerCase().includes(`</${suppressedTag}`)) suppressedTag = null
        return ''
      }
      switch (token.type) {
        case 'checkbox': return '' // The list item emits the task marker once.
        case 'image': return markdownImage(token.text, imageSource(draft, prepared, token.assetId), token.title)
        case 'link': {
          const text = inline(token.tokens)
          if (token.omitLink) return text
          const title = token.title ? ` "${token.title.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : ''
          return `[${text}](<${token.href.replaceAll('>', '%3E')}>${title})`
        }
        case 'strong': return `**${inline(token.tokens)}**`
        case 'em': return `*${inline(token.tokens)}*`
        case 'del': return `~~${inline(token.tokens)}~~`
        case 'html': {
          const closing = token.text.match(/^<\/([a-z][\w-]*)\s*>$/i)
          if (closing) {
            const allowed = draft.purify.sanitize(`<${closing[1]}></${closing[1]}>`, sanitizing)
            return allowed ? `</${closing[1].toLowerCase()}>` : ''
          }
          const opening = token.text.match(/^<([a-z][\w-]*)\b[^>]*>$/i)
          if (opening && /^(script|style|iframe|object)$/i.test(opening[1])) {
            suppressedTag = opening[1].toLowerCase()
            return ''
          }
          const clean = safeHtml(draft, token.text, prepared)
          // Preserve paired inline HTML as paired tags. Sanitizing an opening tag
          // alone otherwise auto-closes it and drops emphasis or link boundaries.
          const end = opening ? `</${opening[1].toLowerCase()}>` : ''
          return end && clean.endsWith(end) ? clean.slice(0, -end.length) : clean
        }
        case 'br': return '  \n'
        default: return token.tokens ? inline(token.tokens) : token.raw ?? token.text ?? ''
      }
    }).join('')
  }
  const blocks = (tokens, compact = false) => tokens.map(token => {
    if (token === draft.titleToken) return ''
    switch (token.type) {
      case 'space': case 'def': return ''
      case 'heading': return `${'#'.repeat(token.depth)} ${inline(token.tokens)}\n\n`
      case 'paragraph': case 'text': return inline(token.tokens ?? [token]) + (compact ? '\n' : '\n\n')
      case 'hr': return '---\n\n'
      case 'code': {
        if (token.assetId) return `${markdownImage(`Mermaid 流程图 ${draft.assets.find(asset => asset.id === token.assetId).index + 1}`, imageSource(draft, prepared, token.assetId))}\n\n`
        // Keep the original fence: a tilde fence can legally have backticks in
        // its info string. Changing it to backticks would expose literal code.
        return `${token.raw}\n\n`
      }
      case 'blockquote': return `${blocks(token.tokens).trimEnd().split('\n').map(line => `> ${line}`).join('\n')}\n\n`
      case 'list': return token.items.map((item, index) => {
        const prefix = token.ordered ? `${Number(token.start) + index}. ` : '- '
        const check = item.task ? `[${item.checked ? 'x' : ' '}] ` : ''
        const lines = blocks(item.tokens, !item.loose).trimEnd().split('\n')
        return `${prefix}${check}${lines[0]}${lines.slice(1).map(line => `\n${' '.repeat(prefix.length)}${line}`).join('')}\n`
      }).join('') + '\n'
      case 'table': {
        const row = cells => `| ${cells.map(cell => inline(cell.tokens).replaceAll('|', '\\|').replaceAll('\n', '<br>')).join(' | ')} |\n`
        const align = token.align.map(value => ({ left: ':---', right: '---:', center: ':---:' })[value] ?? '---')
        return row(token.header) + `| ${align.join(' | ')} |\n` + token.rows.map(row).join('') + '\n'
      }
      case 'html': return `${safeHtml(draft, token.text, prepared)}\n\n`
      default: throw new Error(`暂不支持的正文结构：${token.type}`)
    }
  }).join('')
  return blocks(draft.tokens).trim()
}

export function renderDraft(draft, prepared = new Map()) {
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(token) { return token.draftTitle ? '' : false },
      link(token) { return token.omitLink ? this.parser.parseInline(token.tokens) : false },
      image(token) {
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
        return `<img src="${escapeHtml(imageSource(draft, prepared, token.assetId))}" alt="${escapeHtml(token.text)}"${title}>`
      },
      code(token) {
        if (!token.assetId) {
          const language = (token.lang ?? '').split(/\s/)[0].replace(/[^a-zA-Z0-9_-]/g, '')
          return `<pre data-rin-code-language="${language}"><code>${escapeHtml(token.text)}\n</code></pre>\n`
        }
        const asset = draft.assets.find(asset => asset.id === token.assetId)
        return `<p><img src="${escapeHtml(imageSource(draft, prepared, token.assetId))}" alt="Mermaid 流程图 ${asset.index + 1}" data-rin-mermaid="true"></p>\n`
      },
    },
  })
  // Marked's task-list renderer may annotate its input. Keep the draft immutable
  // so retrying an export cannot accumulate checkboxes or change Markdown output.
  const html = safeHtml(draft, marked.parser(structuredClone(draft.tokens), marked.defaults), prepared)
  const container = draft.windowObject.document.createElement('div')
  container.innerHTML = html
  return {
    title: draft.title, html, portableMarkdown: markdownExport(draft, prepared),
    mermaidCount: draft.mermaidCount, imageCount: container.querySelectorAll('img').length,
    tableCount: container.querySelectorAll('table').length, codeCount: container.querySelectorAll('pre').length,
  }
}
