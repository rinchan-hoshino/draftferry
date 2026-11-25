import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdownLang from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { Code, Image, Paragraph, Parent, Root, RootContent, Text } from 'mdast'
import { toString as mdastToString } from 'mdast-util-to-string'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import type { ArticleBuilder, ArticleResult, MermaidRenderer } from './types.ts'

const REMOTE_OR_INLINE = /^(https?:|data:)/i
const MERMAID_LANG = /^mermaid(?:\s|$)/i
const PLAIN_LANG = /^(?:plain|plaintext|text)?$/i
const MERMAID_HEADER =
  /^(?:(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b|(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|journey|gitGraph|quadrantChart|xychart-beta)\b)/
const SAFE_DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i

export function isMermaidCodeBlock(lang: string | null | undefined, value: string): boolean {
  const trimmedLang = (lang ?? '').trim()
  if (MERMAID_LANG.test(trimmedLang)) return true
  if (!PLAIN_LANG.test(trimmedLang)) return false
  const stripped = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:\s|%%\{[\s\S]*?\}%%)+/, '')
  const firstLine = stripped.split('\n', 1)[0]?.trim() ?? ''
  return MERMAID_HEADER.test(firstLine)
}

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https', 'data'],
  },
}

const markdownParser = unified().use(remarkParse).use(remarkGfm)
const markdownSerializer = unified().use(remarkGfm).use(remarkStringify, {
  bullet: '-',
  fence: '`',
  fences: true,
  resourceLink: false,
})

const HIGHLIGHT_LANGUAGES = {
  javascript,
  typescript,
  python,
  rust,
  go,
  java,
  c,
  cpp,
  csharp,
  bash,
  json,
  yaml,
  ini,
  sql,
  xml,
  css,
  markdown: markdownLang,
  diff,
}

const htmlPipeline = unified()
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize, SANITIZE_SCHEMA)
  .use(rehypeHighlight, {
    languages: HIGHLIGHT_LANGUAGES,
    aliases: {
      ini: ['toml'],
      javascript: ['js', 'jsx'],
      typescript: ['ts', 'tsx'],
    },
  })
  .use(rehypeStringify)

export function findFile(files: Map<string, File>, src: string): File | null {
  let name = String(src ?? '').split(/[?#]/)[0]
  try {
    name = decodeURIComponent(name)
  } catch {
    /* keep raw name */
  }
  name = name.split(/[\\/]/).pop() ?? ''
  if (!name) return null
  const exact = files.get(name)
  if (exact) return exact
  const lower = name.toLowerCase()
  for (const [fileName, file] of files) {
    if (fileName.toLowerCase() === lower) return file
  }
  return null
}

function readAsDataUrl(win: Window, file: File, cache: Map<File, Promise<string>>): Promise<string> {
  const existing = cache.get(file)
  if (existing) return existing
  const promise = new Promise<string>((resolve, reject) => {
    const FileReaderCtor = (win as unknown as { FileReader: typeof FileReader }).FileReader
    const reader = new FileReaderCtor()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error(`读取图片失败：${file.name}`))
    reader.readAsDataURL(file)
  })
  cache.set(file, promise)
  return promise
}

function countMermaid(node: Parent): number {
  let count = 0
  for (const child of node.children) {
    if (child.type === 'code' && isMermaidCodeBlock(child.lang, child.value)) {
      count += 1
    } else if ('children' in child && Array.isArray(child.children)) {
      count += countMermaid(child as Parent)
    }
  }
  return count
}

function extractFirstH1(tree: Root, fallbackTitle: string): string {
  const h1Index = tree.children.findIndex(
    (node) => node.type === 'heading' && node.depth === 1,
  )
  if (h1Index === -1) return fallbackTitle
  const [heading] = tree.children.splice(h1Index, 1)
  return mdastToString(heading).trim() || fallbackTitle
}

export function splitTitle(
  markdown: string,
  fallbackTitle = '',
): { title: string; markdown: string } {
  const normalized = String(markdown ?? '').replace(/\r\n?/g, '\n')
  const tree = markdownParser.parse(normalized)
  const h1Index = tree.children.findIndex(
    (node) => node.type === 'heading' && node.depth === 1,
  )
  if (h1Index === -1) return { title: fallbackTitle, markdown: normalized }
  const title = extractFirstH1(tree, fallbackTitle)
  return {
    title,
    markdown: markdownSerializer.stringify(tree),
  }
}

export function createArticleBuilder({
  window: win,
  renderMermaid,
}: {
  window: Window
  renderMermaid: MermaidRenderer
}): ArticleBuilder {
  const DOMParserCtor = (win as unknown as { DOMParser: typeof DOMParser }).DOMParser
  const parser = new DOMParserCtor()

  return async function buildArticle(
    source: string,
    { fallbackTitle = '', files = new Map(), onProgress } = {},
  ): Promise<ArticleResult> {
    const normalized = String(source ?? '').replace(/\r\n?/g, '\n')
    const tree = markdownParser.parse(normalized)
    const title = extractFirstH1(tree, fallbackTitle)

    const missing: string[] = []
    const mermaidErrors: string[] = []
    const mermaidCache = new Map<string, string>()
    const fileCache = new Map<File, Promise<string>>()
    const mermaidTotal = countMermaid(tree)
    let mermaidIndex = 0

    async function transformChildren(parent: Parent): Promise<void> {
      const nextChildren: RootContent[] = []
      for (const child of parent.children) {
        if (child.type === 'code') {
          const codeNode = child as Code
          if (isMermaidCodeBlock(codeNode.lang, codeNode.value)) {
            mermaidIndex += 1
            onProgress?.(`渲染图表 ${mermaidIndex}/${mermaidTotal}…`)
            try {
              let dataUrl = mermaidCache.get(codeNode.value)
              if (!dataUrl) {
                dataUrl = await renderMermaid(codeNode.value)
                mermaidCache.set(codeNode.value, dataUrl)
              }
              const imgNode: Image = {
                type: 'image',
                url: dataUrl,
                title: null,
                alt: 'Mermaid 图',
              }
              const paraNode: Paragraph = {
                type: 'paragraph',
                children: [imgNode],
              }
              nextChildren.push(paraNode as RootContent)
              continue
            } catch (error) {
              const rawMsg = error instanceof Error ? error.message : String(error)
              const isMissingEngine = /未检测到\s*Mermaid/.test(rawMsg)
              const compact = rawMsg
                .replace(/^Mermaid\s*语法错误[：:]\s*/i, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 140)
              mermaidErrors.push(
                isMissingEngine
                  ? `第 ${mermaidIndex} 张图表渲染失败：${compact}`
                  : `第 ${mermaidIndex} 张图表语法错误：${compact || '请检查图表语法'}`,
              )
            }
          }
          // Non-mermaid code blocks are preserved 100% verbatim
          nextChildren.push(child as RootContent)
          continue
        }

        if (child.type === 'inlineCode') {
          nextChildren.push(child as RootContent)
          continue
        }

        if (child.type === 'image') {
          const imgNode = child as Image
          const src = imgNode.url ?? ''
          if (!src || REMOTE_OR_INLINE.test(src)) {
            nextChildren.push(child as RootContent)
            continue
          }
          const file = findFile(files, src)
          if (!file) {
            missing.push(src)
            const note: Text = {
              type: 'text',
              value: `[缺图：${src}]`,
            }
            nextChildren.push(note as RootContent)
            continue
          }
          imgNode.url = await readAsDataUrl(win, file, fileCache)
          nextChildren.push(child as RootContent)
          continue
        }

        if ('children' in child && Array.isArray(child.children)) {
          await transformChildren(child as Parent)
        }
        nextChildren.push(child as RootContent)
      }
      parent.children = nextChildren as typeof parent.children
    }

    await transformChildren(tree)

    // Path A: lossless standard Markdown for Markdown-native platforms (Zhihu, OSChina)
    const markdown = markdownSerializer.stringify(tree)

    // Path B: sanitized HTML via remark-rehype (allowDangerousHtml: false) + rehype-sanitize
    const hast = await htmlPipeline.run(tree)
    const rawHtml = String(htmlPipeline.stringify(hast))

    // Strip any non-image data: URLs as defense-in-depth
    const root = parser.parseFromString(`<!doctype html><body>${rawHtml}`, 'text/html').body
    for (const img of [...root.querySelectorAll('img')]) {
      const src = img.getAttribute('src') ?? ''
      if (src.startsWith('data:') && !SAFE_DATA_IMAGE.test(src)) {
        img.removeAttribute('src')
      }
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
