import { marked } from 'marked'
import createDOMPurify from 'dompurify'

const REMOTE_OR_INLINE = /^(https?:|data:)/i
const MERMAID_LANG = /^mermaid(?:\s|$)/i

export function findFile(files, src) {
  let name = String(src ?? '').split(/[?#]/)[0]
  try { name = decodeURIComponent(name) } catch { /* keep raw name */ }
  name = name.split(/[\\/]/).pop()
  if (!name) return null
  if (files.has(name)) return files.get(name)
  const lower = name.toLowerCase()
  for (const [fileName, file] of files) {
    if (fileName.toLowerCase() === lower) return file
  }
  return null
}

function readAsDataUrl(win, file, cache) {
  if (cache.has(file)) return cache.get(file)
  const promise = new Promise((resolve, reject) => {
    const reader = new win.FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error ?? new Error(`读取图片失败：${file.name}`))
    reader.readAsDataURL(file)
  })
  cache.set(file, promise)
  return promise
}

function childGroups(token) {
  if (!token || typeof token !== 'object') return []
  if (token.type === 'code' || token.type === 'codespan') return []
  const groups = []
  if (Array.isArray(token.tokens)) groups.push(token.tokens)
  if (token.type === 'list' && Array.isArray(token.items)) groups.push(token.items)
  if (token.type === 'table') {
    if (Array.isArray(token.header)) groups.push(token.header)
    if (Array.isArray(token.rows)) {
      for (const row of token.rows) if (Array.isArray(row)) groups.push(row)
    }
  }
  return groups
}

function countMermaid(tokens) {
  let count = 0
  const walk = (list) => {
    for (const token of list) {
      if (token.type === 'code' && MERMAID_LANG.test((token.lang ?? '').trim())) {
        count += 1
      } else {
        for (const group of childGroups(token)) walk(group)
      }
    }
  }
  walk(tokens)
  return count
}

function serializeToken(token) {
  if (!token._dirty) return token.raw ?? ''
  if (token._replacedRaw != null) return token._replacedRaw
  const raw = token.raw ?? ''
  const children = []
  for (const group of childGroups(token)) {
    for (const child of group) {
      if (typeof child._origRaw === 'string' && child._origRaw.length > 0) children.push(child)
    }
  }
  if (!children.length) return raw
  let out = ''
  let cursor = 0
  for (const child of children) {
    const pos = raw.indexOf(child._origRaw, cursor)
    if (pos === -1) continue
    out += raw.slice(cursor, pos)
    out += child._dirty ? serializeToken(child) : child._origRaw
    cursor = pos + child._origRaw.length
  }
  return out + raw.slice(cursor)
}

export function splitTitle(markdown, fallbackTitle = '') {
  const normalized = String(markdown ?? '').replace(/\r\n?/g, '\n')
  const tokens = marked.lexer(normalized, { gfm: true })
  const h1Index = tokens.findIndex(token => token.type === 'heading' && token.depth === 1)
  if (h1Index === -1) return { title: fallbackTitle, markdown: normalized }
  const [heading] = tokens.splice(h1Index, 1)
  return {
    title: heading.text.trim() || fallbackTitle,
    markdown: tokens.map(token => token.raw).join(''),
  }
}

export function createArticleBuilder({ window: win, renderMermaid }) {
  const purify = createDOMPurify(win)
  const parser = new win.DOMParser()

  return async function buildArticle(source, { fallbackTitle = '', files = new Map(), onProgress } = {}) {
    const normalized = String(source ?? '').replace(/\r\n?/g, '\n')
    const tokens = marked.lexer(normalized, { gfm: true })
    const h1Index = tokens.findIndex(token => token.type === 'heading' && token.depth === 1)
    let title = fallbackTitle
    if (h1Index !== -1) {
      const [heading] = tokens.splice(h1Index, 1)
      title = heading.text.trim() || fallbackTitle
    }

    const missing = []
    const mermaidErrors = []
    const mermaidCache = new Map()
    const fileCache = new Map()
    const mermaidTotal = countMermaid(tokens)
    let mermaidIndex = 0

    async function transform(list) {
      let dirty = false
      for (const token of list) {
        token._origRaw = token.raw ?? ''
        if (token.type === 'code' && MERMAID_LANG.test((token.lang ?? '').trim())) {
          mermaidIndex += 1
          onProgress?.(`渲染图表 ${mermaidIndex}/${mermaidTotal}…`)
          try {
            if (!mermaidCache.has(token.text)) {
              mermaidCache.set(token.text, await renderMermaid(token.text))
            }
            const dataUrl = mermaidCache.get(token.text)
            const imgRaw = `![Mermaid 图](${dataUrl})`
            token.type = 'paragraph'
            token.text = imgRaw
            token.tokens = [{ type: 'image', raw: imgRaw, href: dataUrl, title: null, text: 'Mermaid 图', tokens: [] }]
            delete token.lang
            delete token.codeBlockStyle
            token._dirty = true
            token._replacedRaw = `${imgRaw}\n\n`
            dirty = true
          } catch (error) {
            mermaidErrors.push(error?.message || String(error))
          }
          continue
        }
        if (token.type === 'code' || token.type === 'codespan') continue
        if (token.type === 'image') {
          const src = token.href ?? ''
          if (!src || REMOTE_OR_INLINE.test(src)) continue
          const file = findFile(files, src)
          if (!file) {
            missing.push(src)
            const note = `[缺图：${src}]`
            token.type = 'text'
            token.text = note
            delete token.href
            delete token.title
            delete token.tokens
            token._dirty = true
            token._replacedRaw = note
            dirty = true
            continue
          }
          const dataUrl = await readAsDataUrl(win, file, fileCache)
          token.href = dataUrl
          const titlePart = token.title ? ` "${token.title}"` : ''
          token._dirty = true
          token._replacedRaw = `![${token.text ?? ''}](${dataUrl}${titlePart})`
          dirty = true
          continue
        }
        let childDirty = false
        for (const group of childGroups(token)) {
          if (await transform(group)) childDirty = true
        }
        if (childDirty) {
          token._dirty = true
          dirty = true
        }
      }
      return dirty
    }

    await transform(tokens)
    const markdown = tokens.map(serializeToken).join('')
    const rawHtml = String(marked.parser(tokens, { gfm: true }))
    const clean = purify.sanitize(rawHtml)
    const root = parser.parseFromString(`<!doctype html><body>${clean}`, 'text/html').body

    for (const img of [...root.querySelectorAll('img')]) {
      const src = img.getAttribute('src') ?? ''
      if (!src || REMOTE_OR_INLINE.test(src)) continue
      const file = findFile(files, src)
      if (!file) {
        missing.push(src)
        const note = root.ownerDocument.createElement('p')
        note.textContent = `[缺图：${src}]`
        img.replaceWith(note)
        continue
      }
      img.setAttribute('src', await readAsDataUrl(win, file, fileCache))
    }

    return {
      title,
      markdown,
      html: root.innerHTML,
      imageCount: root.querySelectorAll('img').length,
      missing,
      mermaidErrors,
    }
  }
}
