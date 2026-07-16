import mermaid from 'mermaid'

let initialized = false
let renderSequence = 0

function parseSvgSize(svgElement) {
  const viewBox = svgElement.getAttribute('viewBox')
    ?.trim()
    .split(/[ ,]+/)
    .map(Number)
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    return { width: viewBox[2], height: viewBox[3] }
  }

  const width = Number.parseFloat(svgElement.getAttribute('width'))
  const height = Number.parseFloat(svgElement.getAttribute('height'))
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { width, height }
  }

  return { width: 800, height: 600 }
}

export async function svgToPngDataUrl(svg, windowObject = window) {
  const parsed = new windowObject.DOMParser().parseFromString(svg, 'image/svg+xml')
  const svgElement = parsed.documentElement
  if (svgElement.nodeName.toLowerCase() === 'parsererror') {
    throw new Error('Mermaid 生成了无效的 SVG')
  }

  const { width, height } = parseSvgSize(svgElement)
  const scale = Math.min(2, 3200 / Math.max(width, height))
  const canvasWidth = Math.max(1, Math.ceil(width * scale))
  const canvasHeight = Math.max(1, Math.ceil(height * scale))
  svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svgElement.setAttribute('width', String(width))
  svgElement.setAttribute('height', String(height))

  const serialized = new windowObject.XMLSerializer().serializeToString(svgElement)
  const blob = new windowObject.Blob([serialized], {
    type: 'image/svg+xml;charset=utf-8',
  })
  const objectUrl = windowObject.URL.createObjectURL(blob)

  try {
    const image = new windowObject.Image()
    image.decoding = 'async'
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('浏览器无法载入 Mermaid SVG'))
    })
    image.src = objectUrl
    await loaded

    const canvas = windowObject.document.createElement('canvas')
    canvas.width = canvasWidth
    canvas.height = canvasHeight
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('浏览器无法创建 Mermaid PNG 画布')
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvasWidth, canvasHeight)
    context.drawImage(image, 0, 0, canvasWidth, canvasHeight)
    return canvas.toDataURL('image/png')
  } finally {
    windowObject.URL.revokeObjectURL(objectUrl)
  }
}

export async function renderMermaidPng(source) {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      theme: 'default',
      suppressErrorRendering: true,
    })
    initialized = true
  }

  renderSequence += 1
  const id = `rin-sohu-mermaid-${Date.now()}-${renderSequence}`
  let result
  try {
    result = await mermaid.render(id, source)
  } catch (error) {
    throw new Error(
      `Mermaid 语法错误：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  return svgToPngDataUrl(result.svg)
}
