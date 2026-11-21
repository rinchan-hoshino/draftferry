const SCALE = 2
const MAX_SIDE = 8192

async function loadMermaid() {
  const module = await import('mermaid')
  return module.default
}

function hashSource(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${text.length}:${hash >>> 0}`
}

function svgSize(svgElement) {
  const viewBox = (svgElement.getAttribute('viewBox') ?? '').trim().split(/[ ,]+/).map(Number)
  if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] }
  }
  const width = Number.parseFloat(svgElement.getAttribute('width'))
  const height = Number.parseFloat(svgElement.getAttribute('height'))
  if (width > 0 && height > 0) return { width, height }
  const styleWidth = Number.parseFloat(svgElement.style?.maxWidth || svgElement.style?.width)
  const styleHeight = Number.parseFloat(svgElement.style?.maxHeight || svgElement.style?.height)
  if (styleWidth > 0 && styleHeight > 0) return { width: styleWidth, height: styleHeight }
  throw new Error('Mermaid 图尺寸为空')
}

async function svgToPng(svg) {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const svgElement = parsed.documentElement
  if (svgElement.nodeName.toLowerCase() === 'parsererror') throw new Error('Mermaid 生成了无效的 SVG')
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

export function createMermaidRenderer(load = loadMermaid) {
  let ready = null
  let sequence = 0
  const cache = new Map()

  const getMermaid = () => {
    ready ??= load().then((mermaid) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        htmlLabels: false,
        suppressErrorRendering: true,
      })
      return mermaid
    }).catch((error) => {
      ready = null
      throw error
    })
    return ready
  }

  return async function renderMermaidPng(source) {
    const key = hashSource(source)
    if (cache.has(key)) return cache.get(key)
    const mermaid = await getMermaid()
    sequence += 1
    let svg
    try {
      ;({ svg } = await mermaid.render(`rin-draftferry-${sequence}`, source))
    } catch (error) {
      throw new Error(`Mermaid 语法错误：${error?.message || error}`, { cause: error })
    }
    const png = await svgToPng(svg)
    cache.set(key, png)
    return png
  }
}
