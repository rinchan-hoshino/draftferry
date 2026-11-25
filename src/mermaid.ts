import type { MermaidRenderer } from './types.ts'

const SCALE = 2
const MAX_SIDE = 8192
const CANVAS_PADDING = 16

const FLOWCHART_HEADER = /^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i
const UNICODE_ARROW = /(?:[\u2013\u2014\u2015\u2212\uFF0D]+-*|-+[\u2013\u2014\u2015\u2212\uFF0D]+)[>＞]/g
const STICKY_DIRECTIVE =
  /([^\n\r \t])[ \t]+(?=(?:style[ \t]+[A-Za-z0-9_-]+[ \t]+|classDef[ \t]+|linkStyle[ \t]+|subgraph[ \t]+))/g
const UNQUOTED_BRACKET_NODE = /\b([A-Za-z0-9_-]+)\[([^[\]\r\n"]+)\]/g
const HTML_BR_TAG = /<br\s*\/?>/gi

export interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
}

export interface CreateMermaidRendererOptions {
  loadMermaid?: () => Promise<MermaidApi>
}

function isMermaidApi(value: unknown): value is MermaidApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MermaidApi).render === 'function' &&
    typeof (value as MermaidApi).initialize === 'function'
  )
}

export async function defaultLoadMermaid(): Promise<MermaidApi> {
  const fromGlobal = (globalThis as Record<string, unknown>).mermaid
  if (isMermaidApi(fromGlobal)) return fromGlobal

  const fromWindow =
    typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>).mermaid
      : undefined
  if (isMermaidApi(fromWindow)) return fromWindow

  throw new Error('未检测到 Mermaid 渲染引擎，请在篡改猴中更新 Folio 脚本以加载 @require 依赖')
}

interface QuoteSegment {
  quoted: boolean
  text: string
}

function splitByDoubleQuotes(input: string): QuoteSegment[] {
  const segments: QuoteSegment[] = []
  let buffer = ''
  let inQuote = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (inQuote) {
      buffer += ch
      if (ch === '\\' && i + 1 < input.length) {
        buffer += input[i + 1]
        i += 1
      } else if (ch === '"') {
        segments.push({ quoted: true, text: buffer })
        buffer = ''
        inQuote = false
      }
    } else if (ch === '"') {
      if (buffer) segments.push({ quoted: false, text: buffer })
      buffer = '"'
      inQuote = true
    } else {
      buffer += ch
    }
  }

  if (buffer) segments.push({ quoted: inQuote, text: buffer })
  return segments
}

function mapOutsideDoubleQuotes(
  input: string,
  transform: (segment: string, prevChar: string) => string,
): string {
  const segments = splitByDoubleQuotes(input)
  let out = ''
  for (const seg of segments) {
    if (seg.quoted) {
      out += seg.text
    } else {
      const prevChar = out.length > 0 ? out[out.length - 1] : ''
      out += transform(seg.text, prevChar)
    }
  }
  return out
}

function isFlowchartSource(source: string): boolean {
  const stripped = source.replace(/^(?:\s|%%\{[\s\S]*?\}%%)+/, '')
  const firstLine = stripped.split('\n', 1)[0]?.trim() ?? ''
  return FLOWCHART_HEADER.test(firstLine)
}

export function normalizeMermaidSource(source: string): string {
  let text = String(source ?? '').replace(/\r\n?/g, '\n')
  const isFlowchart = isFlowchartSource(text)

  // (a) Normalize Chinese/Unicode dash arrows (—>, ——>, –>, －>) outside double quotes
  text = mapOutsideDoubleQuotes(text, (segment) => segment.replace(UNICODE_ARROW, '-->'))

  if (!isFlowchart) return text

  // (b) Break single-line glued flowchart directives (style/classDef/linkStyle/subgraph) outside quotes
  text = mapOutsideDoubleQuotes(text, (segment, prevChar) => {
    let next = segment.replace(STICKY_DIRECTIVE, '$1\n')
    if (prevChar && prevChar !== '\n' && prevChar !== '\r' && prevChar !== ' ' && prevChar !== '\t') {
      next = next.replace(
        /^[ \t]+(?=(?:style[ \t]+[A-Za-z0-9_-]+[ \t]+|classDef[ \t]+|linkStyle[ \t]+|subgraph[ \t]+))/,
        '\n',
      )
    }
    return next
  })

  // (d) Convert <br/> / <br> inside flowchart labels to Mermaid native SVG <tspan> line break (\n)
  text = text.replace(HTML_BR_TAG, '\\n')

  // (c) Quote unquoted square-bracket node labels containing '/' (e.g. A[客户/银行账户])
  text = mapOutsideDoubleQuotes(text, (segment) =>
    segment.replace(UNQUOTED_BRACKET_NODE, (match, id: string, label: string) => {
      if (!label.includes('/')) return match
      const trimmed = label.trim()
      if (
        trimmed.startsWith('/') ||
        trimmed.startsWith('\\') ||
        trimmed.endsWith('/') ||
        trimmed.endsWith('\\')
      ) {
        return match
      }
      return `${id}["${label}"]`
    }),
  )

  return text
}

function hashSource(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${text.length}:${hash >>> 0}`
}

function svgSize(svgElement: Element): { width: number; height: number } {
  const viewBox = (svgElement.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[ ,]+/)
    .map(Number)
  if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] }
  }
  const width = Number.parseFloat(svgElement.getAttribute('width') ?? '')
  const height = Number.parseFloat(svgElement.getAttribute('height') ?? '')
  if (width > 0 && height > 0) return { width, height }
  const styled = svgElement as HTMLElement
  const styleWidth = Number.parseFloat(styled.style?.maxWidth || styled.style?.width || '')
  const styleHeight = Number.parseFloat(styled.style?.maxHeight || styled.style?.height || '')
  if (styleWidth > 0 && styleHeight > 0) return { width: styleWidth, height: styleHeight }
  throw new Error('Mermaid 图尺寸为空')
}

async function svgToPng(svg: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const svgElement = parsed.documentElement
  if (svgElement.nodeName.toLowerCase() === 'parsererror') {
    throw new Error('Mermaid 生成了无效的 SVG')
  }
  const { width, height } = svgSize(svgElement)
  svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svgElement.setAttribute('width', String(width))
  svgElement.setAttribute('height', String(height))
  const serialized = new XMLSerializer().serializeToString(svgElement)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`

  const image = new Image()
  image.src = url
  await image.decode()

  const totalWidth = width + CANVAS_PADDING * 2
  const totalHeight = height + CANVAS_PADDING * 2
  const scale = Math.min(SCALE, MAX_SIDE / totalWidth, MAX_SIDE / totalHeight)
  const pad = Math.round(CANVAS_PADDING * scale)
  const drawWidth = Math.max(1, Math.ceil(width * scale))
  const drawHeight = Math.max(1, Math.ceil(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = drawWidth + pad * 2
  canvas.height = drawHeight + pad * 2
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建画布')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, pad, pad, drawWidth, drawHeight)
  return canvas.toDataURL('image/png')
}

export function createMermaidRenderer(
  options: CreateMermaidRendererOptions = {},
): MermaidRenderer {
  const load = options.loadMermaid ?? defaultLoadMermaid
  let ready: Promise<MermaidApi> | null = null
  let sequence = 0
  const cache = new Map<string, string>()

  const getMermaid = (): Promise<MermaidApi> => {
    ready ??= load()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            background: '#ffffff',
            primaryColor: '#f8fafc',
            primaryTextColor: '#1e293b',
            primaryBorderColor: '#64748b',
            lineColor: '#475569',
            secondaryColor: '#f1f5f9',
            tertiaryColor: '#ffffff',
            fontFamily:
              '"PingFang SC", -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif',
            fontSize: '14px',
          },
          htmlLabels: false,
          flowchart: {
            htmlLabels: false,
          },
          suppressErrorRendering: true,
        })
        return mermaid
      })
      .catch((error) => {
        ready = null
        throw error
      })
    return ready
  }

  return async function renderMermaidPng(source: string): Promise<string> {
    const normalized = normalizeMermaidSource(source)
    const key = hashSource(normalized)
    const cached = cache.get(key)
    if (cached) return cached
    const mermaid = await getMermaid()
    sequence += 1
    let svg: string
    try {
      ;({ svg } = await mermaid.render(`rin-folio-${sequence}`, normalized))
    } catch (error) {
      throw new Error(
        `Mermaid 语法错误：${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      )
    }
    const png = await svgToPng(svg)
    cache.set(key, png)
    return png
  }
}
