import type { MermaidRenderer } from './types.ts'

const SCALE = 2
const MAX_SIDE = 8192

export const MERMAID_URLS = [
  `https://acv.k-neco.com/tools/vendor/mermaid-${__MERMAID_VERSION__}.min.js`,
  `https://cdn.jsdelivr.net/npm/mermaid@${__MERMAID_VERSION__}/dist/mermaid.min.js`,
] as const

export interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
}

declare const GM_xmlhttpRequest:
  | ((details: {
      method: string
      url: string
      timeout?: number
      onload?: (res: { status: number; responseText: string }) => void
      onerror?: (err: unknown) => void
      ontimeout?: () => void
    }) => void)
  | undefined

function fetchScriptViaGM(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      reject(new Error('GM_xmlhttpRequest unavailable'))
      return
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      timeout: 20_000,
      onload(res) {
        if (res.status >= 200 && res.status < 300 && res.responseText) {
          resolve(res.responseText)
        } else {
          reject(new Error(`HTTP ${res.status} loading ${url}`))
        }
      },
      onerror(err) {
        reject(err instanceof Error ? err : new Error(`Failed loading ${url}`))
      },
      ontimeout() {
        reject(new Error(`Timeout loading ${url}`))
      },
    })
  })
}

async function fetchScriptText(url: string): Promise<string> {
  if (typeof GM_xmlhttpRequest === 'function') {
    return fetchScriptViaGM(url)
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`)
  return response.text()
}

function evaluateMermaidScript(code: string): MermaidApi | null {
  const g = globalThis as Record<string, unknown>
  // Non-strict indirect eval attaches top-level `var` bindings (e.g. __esbuild_esm_mermaid_nm)
  // to `globalThis` instead of an eval-local scope.
  const normalized = code.replace(/^\s*(['"])use strict\1\s*;?/, '')
  ;(0, eval)(normalized)
  const api = g.mermaid as MermaidApi | undefined
  return api && typeof api.render === 'function' ? api : null
}

async function verifyMermaidIntegrity(code: string): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  const actual = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  if (actual !== __MERMAID_SHA256__) {
    throw new Error(`Mermaid 完整性校验失败：预期 ${__MERMAID_SHA256__}，实际 ${actual}`)
  }
}

export async function defaultLoadMermaid(): Promise<MermaidApi> {
  const existing = (globalThis as Record<string, unknown>).mermaid as MermaidApi | undefined
  if (existing && typeof existing.render === 'function') return existing

  let lastError: unknown = null
  for (const url of MERMAID_URLS) {
    try {
      const code = await fetchScriptText(url)
      await verifyMermaidIntegrity(code)
      const api = evaluateMermaidScript(code)
      if (api) return api
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `Mermaid 加载失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
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

  const scale = Math.min(SCALE, MAX_SIDE / width, MAX_SIDE / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建画布')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export function createMermaidRenderer(
  load: () => Promise<MermaidApi> = defaultLoadMermaid,
): MermaidRenderer {
  let ready: Promise<MermaidApi> | null = null
  let sequence = 0
  const cache = new Map<string, string>()

  const getMermaid = (): Promise<MermaidApi> => {
    ready ??= load()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'default',
          htmlLabels: false,
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
    const key = hashSource(source)
    const cached = cache.get(key)
    if (cached) return cached
    const mermaid = await getMermaid()
    sequence += 1
    let svg: string
    try {
      ;({ svg } = await mermaid.render(`rin-folio-${sequence}`, source))
    } catch (error) {
      throw new Error(`Mermaid 语法错误：${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      })
    }
    const png = await svgToPng(svg)
    cache.set(key, png)
    return png
  }
}
