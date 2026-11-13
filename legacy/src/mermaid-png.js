let renderSequence = 0

const PNG_MAX_WIDTH = 1000
const PNG_MAX_HEIGHT = 3200
const PNG_CACHE_LIMIT = 50

function parseSvgSize(svgElement) {
  const viewBox = svgElement.getAttribute('viewBox')
    ?.trim()
    .split(/[ ,]+/)
    .map(Number)
  if (
    viewBox?.length === 4
    && viewBox.every(Number.isFinite)
    && viewBox[2] > 0
    && viewBox[3] > 0
  ) {
    return { width: viewBox[2], height: viewBox[3] }
  }

  const width = Number.parseFloat(svgElement.getAttribute('width'))
  const height = Number.parseFloat(svgElement.getAttribute('height'))
  if (
    Number.isFinite(width)
    && Number.isFinite(height)
    && width > 0
    && height > 0
  ) {
    return { width, height }
  }

  return { width: 800, height: 600 }
}

export function calculatePngDimensions(width, height) {
  const scale = Math.min(
    1,
    PNG_MAX_WIDTH / width,
    PNG_MAX_HEIGHT / height,
  )
  return {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil(height * scale)),
  }
}

export async function svgToPngDataUrl(svg, windowObject = window) {
  const parsed = new windowObject.DOMParser().parseFromString(svg, 'image/svg+xml')
  const svgElement = parsed.documentElement
  if (svgElement.nodeName.toLowerCase() === 'parsererror') {
    throw new Error('Mermaid 生成了无效的 SVG')
  }

  const sourceSize = parseSvgSize(svgElement)
  const outputSize = calculatePngDimensions(sourceSize.width, sourceSize.height)
  svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svgElement.setAttribute('width', String(sourceSize.width))
  svgElement.setAttribute('height', String(sourceSize.height))

  const serialized = new windowObject.XMLSerializer().serializeToString(svgElement)
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`
  const image = new windowObject.Image()
  image.decoding = 'async'
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error('浏览器无法载入 Mermaid SVG'))
  })
  image.src = dataUrl
  await loaded

  const canvas = windowObject.document.createElement('canvas')
  canvas.width = outputSize.width
  canvas.height = outputSize.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('浏览器无法创建 Mermaid PNG 画布')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, outputSize.width, outputSize.height)
  context.drawImage(image, 0, 0, outputSize.width, outputSize.height)
  return canvas.toDataURL('image/png')
}

async function loadOfficialMermaid() {
  const module = await import('mermaid')
  return module.default
}

export function createMermaidPngRenderer(options = {}) {
  const loadMermaid = options.loadMermaid ?? loadOfficialMermaid
  const convertSvg = options.convertSvg ?? svgToPngDataUrl
  const cache = new Map()
  let mermaidPromise

  const getMermaid = () => {
    if (!mermaidPromise) {
      const loading = loadMermaid().then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          theme: 'default',
          suppressErrorRendering: true,
        })
        return mermaid
      })
      mermaidPromise = loading
      loading.catch(() => {
        if (mermaidPromise === loading) {
          mermaidPromise = undefined
        }
      })
    }
    return mermaidPromise
  }

  return async (source) => {
    const cached = cache.get(source)
    if (cached) {
      cache.delete(source)
      cache.set(source, cached)
      return cached
    }

    const rendering = (async () => {
      const mermaid = await getMermaid()
      renderSequence += 1
      const id = `rin-draftferry-mermaid-${Date.now()}-${renderSequence}`
      let result
      try {
        result = await mermaid.render(id, source)
      } catch (error) {
        throw new Error(
          `Mermaid 语法错误：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      return convertSvg(result.svg)
    })()

    cache.set(source, rendering)
    if (cache.size > PNG_CACHE_LIMIT) {
      cache.delete(cache.keys().next().value)
    }
    try {
      return await rendering
    } catch (error) {
      if (cache.get(source) === rendering) {
        cache.delete(source)
      }
      throw error
    }
  }
}

export const renderMermaidPng = createMermaidPngRenderer()
