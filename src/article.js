import { marked } from 'marked'
import createDOMPurify from 'dompurify'

const REMOTE_OR_INLINE = /^(https?:|data:)/i

// 第一处一级标题（不在代码块里）作为文章标题，并从正文里去掉这一行。
export function splitTitle(markdown, fallbackTitle = '') {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let fence = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence) continue
    const heading = line.match(/^ {0,3}#[ \t]+(\S.*?)\s*$/)
    if (heading) {
      return {
        title: heading[1].trim(),
        markdown: [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n'),
      }
    }
  }
  return { title: fallbackTitle, markdown }
}

function findFile(files, src) {
  let name = src.split(/[?#]/)[0]
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

function readAsDataUrl(win, file) {
  return new Promise((resolve, reject) => {
    const reader = new win.FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error ?? new Error(`读取图片失败：${file.name}`))
    reader.readAsDataURL(file)
  })
}

// 把 Markdown 变成可写入编辑器的 HTML：标题拆出、marked 转换、DOMPurify 清洗、
// 本地图片转 data URL、Mermaid 转 PNG。任何一张图出错都不中断，只记到结果里。
export function createArticleBuilder({ window: win, renderMermaid }) {
  const purify = createDOMPurify(win)
  const parser = new win.DOMParser()

  return async function buildArticle(markdown, { fallbackTitle = '', files = new Map() } = {}) {
    const split = splitTitle(markdown, fallbackTitle)
    const rawHtml = String(marked.parse(split.markdown, { gfm: true, async: false }))
    const clean = purify.sanitize(rawHtml)
    const root = parser.parseFromString(`<!doctype html><body>${clean}`, 'text/html').body
    const doc = root.ownerDocument

    const missing = []
    for (const img of [...root.querySelectorAll('img')]) {
      const src = img.getAttribute('src') ?? ''
      if (!src || REMOTE_OR_INLINE.test(src)) continue
      const file = findFile(files, src)
      if (!file) {
        missing.push(src)
        const note = doc.createElement('p')
        note.textContent = `[缺图：${src}]`
        img.replaceWith(note)
        continue
      }
      img.setAttribute('src', await readAsDataUrl(win, file))
    }

    const mermaidErrors = []
    for (const code of [...root.querySelectorAll('pre > code.language-mermaid')]) {
      const pre = code.parentElement
      try {
        const png = await renderMermaid(code.textContent)
        const img = doc.createElement('img')
        img.setAttribute('src', png)
        img.setAttribute('alt', 'Mermaid 图')
        pre.replaceWith(img)
      } catch (error) {
        mermaidErrors.push(error?.message || String(error))
      }
    }

    return {
      title: split.title,
      html: root.innerHTML,
      imageCount: root.querySelectorAll('img').length,
      missing,
      mermaidErrors,
    }
  }
}
