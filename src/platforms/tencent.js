import { collectOpenRoots, isUsable, squash } from '../dom.js'
import { hostMatches } from './shared.js'

// 腾讯云市场：只写“商品详情”的 wangEditor v3 字段。DOM 事实与上传逻辑来自 legacy/src/tencent-market.js。
// wangEditor 实例在页面框架（Vue）里，只接受 txt.html 和 $textElem 都对得上这个编辑区的那一个。
const UPLOAD_TIMEOUT_MS = 30_000

function normalizedLabel(element) {
  return element.textContent?.replace(/\s+/g, '').replace(/^[*＊]+|[：:*＊]+$/g, '') ?? ''
}

function isFormItemBoundary(element) {
  return [...element.classList].some((name) => {
    const lower = name.toLowerCase()
    return lower.includes('form') && lower.includes('item')
      && !['control', 'label', 'editor', 'content'].some(word => lower.includes(word))
  })
}

function isDetailEditor(editor) {
  let ancestor = editor.parentElement
  for (let depth = 0; ancestor && ancestor !== editor.ownerDocument.body && depth < 6; depth += 1) {
    const hasLabel = [...ancestor.querySelectorAll('label, span, div')].some(element => (
      element !== editor && !editor.contains(element) && normalizedLabel(element) === '商品详情'
    ))
    if (hasLabel) return true
    if (isFormItemBoundary(ancestor)) return false
    ancestor = ancestor.parentElement
  }
  return false
}

function isVisibleBox(element) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isAssociatedLabel(label, editor) {
  if (!isVisibleBox(label) || !isVisibleBox(editor)) return false
  const l = label.getBoundingClientRect()
  const e = editor.getBoundingClientRect()
  const verticalOverlap = Math.min(l.bottom, e.bottom) - Math.max(l.top, e.top)
  const sameRow = verticalOverlap > 0 && l.right <= e.right && Math.max(0, e.left - l.right) <= 400
  const horizontalOverlap = Math.min(l.right, e.right) - Math.max(l.left, e.left)
  const stacked = horizontalOverlap > 0 && e.top - l.bottom >= 0 && e.top - l.bottom <= 120
  return sameRow || stacked
}

export function findTencentDetailEditor(doc) {
  const matches = new Set()
  for (const root of collectOpenRoots(doc)) {
    const editors = [...root.querySelectorAll('.w-e-text[contenteditable="true"]')].filter(isUsable)
    for (const editor of editors.filter(isDetailEditor)) matches.add(editor)
    const labels = [...root.querySelectorAll('label, span, div')].filter(element => (
      normalizedLabel(element) === '商品详情' && (element.matches('label, span') || element.children.length === 0)
    ))
    for (const editor of editors) {
      if (labels.some(label => isAssociatedLabel(label, editor))) matches.add(editor)
    }
  }
  if (matches.size === 1) return [...matches][0]
  throw new Error('腾讯云市场：未找到唯一且标注为“商品详情”的编辑器')
}

// 从编辑区往上找 Vue 组件，取到一个 wangEditor v3：有 txt.html，且 $textElem 指向这个编辑区。
export function findWangEditor(target) {
  const found = []
  const seen = new Set()
  const queue = []
  for (let el = target; el; el = el.parentElement) {
    const owner = Object.getOwnPropertyDescriptor(el, '__vue__')?.value
    if (owner) queue.push({ value: owner, depth: 0 })
  }
  while (queue.length) {
    const { value, depth } = queue.shift()
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 8) continue
    seen.add(value)
    try {
      if (typeof value.txt?.html === 'function' && value.$textElem) {
        const first = value.$textElem.elems?.[0] ?? value.$textElem[0]
        if (first === target) found.push(value)
      }
    } catch { /* 取不到的字段当作不是编辑器 */ }
    for (const key of ['editor', '$parent', '_data', 'data', 'props']) {
      try {
        if (value[key]) queue.push({ value: value[key], depth: depth + 1 })
      } catch { /* skip */ }
    }
  }
  return found.length === 1 ? found[0] : null
}

function uploadedUrl(win, source) {
  if (typeof source !== 'string' || !/^(?:https?:)?\/\//i.test(source.trim())) return null
  try {
    const url = new win.URL(source, win.location.href)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function dataUrlToFile(win, source, name) {
  const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i)
  if (!match) throw new Error('腾讯云市场：内嵌图片不是有效的 Base64 图片')
  const binary = win.atob(match[2])
  const bytes = win.Uint8Array.from(binary, c => c.charCodeAt(0))
  const type = match[1].toLowerCase()
  const ext = type.split('/')[1] === 'jpeg' ? 'jpg' : type.split('/')[1]
  return new win.File([new win.Blob([bytes], { type })], `${name}.${ext}`, { type })
}

// 上传一张图：优先用 wangEditor 配置里的 customUploadImg；没有就按配置发 XHR。
function uploadOne(win, nativeEditor, file, index, signal) {
  const config = nativeEditor.config ?? {}
  if (typeof config.customUploadImg !== 'function' && !config.uploadImgServer) {
    throw new Error('腾讯云市场：无法取得商品详情的图片上传配置，原文未改动')
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let request
    const finish = (error, url) => {
      if (settled) return
      settled = true
      win.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) {
        request?.abort()
        reject(error)
      } else resolve(url)
    }
    const onAbort = () => finish(new Error('页面已切换，已停止导入'))
    const fail = () => finish(new Error(`腾讯云市场：第 ${index + 1} 张图片上传失败，原文未改动；请重试`))
    const timer = win.setTimeout(() => finish(new Error(`腾讯云市场：第 ${index + 1} 张内嵌图片上传超时，原文未改动`)), UPLOAD_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    // 只把回调交给上传器，不把 wangEditor 的插入函数交出去，避免过期回调插到错误位置。
    const receiveUrl = (source) => {
      if (settled) return
      const url = uploadedUrl(win, source)
      finish(url ? null : new Error('腾讯云市场：图片上传未返回有效地址，原文未改动'), url)
    }
    try {
      if (typeof config.customUploadImg === 'function') {
        config.customUploadImg([file], receiveUrl)?.catch?.(fail)
        return
      }
      const endpoint = new win.URL(config.uploadImgServer, win.location.href)
      const body = new win.FormData()
      body.append(config.uploadFileName || file.name, file)
      for (const [key, value] of Object.entries(config.uploadImgParams ?? {})) body.append(key, value)
      request = new win.XMLHttpRequest()
      request.open('POST', endpoint.href)
      request.withCredentials = Boolean(config.withCredentials)
      for (const [key, value] of Object.entries(config.uploadImgHeaders ?? {})) request.setRequestHeader(key, value)
      request.onerror = fail
      request.ontimeout = fail
      request.onload = () => {
        try {
          if (request.status < 200 || request.status >= 300) return fail()
          const result = JSON.parse(request.responseText)
          if (String(result.errno) === '0' && Array.isArray(result.data) && result.data.length === 1) {
            receiveUrl(typeof result.data[0] === 'string' ? result.data[0] : result.data[0]?.url)
          } else fail()
        } catch {
          fail()
        }
      }
      request.send(body)
    } catch (error) {
      finish(error)
    }
  })
}

// 返回新的 HTML：data 图片全部上传后换成平台地址；上传失败整篇不写入。
async function uploadEmbeddedImages(win, nativeEditor, html, signal) {
  const doc = win.document.implementation.createHTMLDocument('')
  doc.body.innerHTML = html
  let index = 0
  for (const image of doc.querySelectorAll('img')) {
    const source = image.getAttribute('src')?.trim() ?? ''
    if (/^data:image\//i.test(source)) {
      const url = await uploadOne(win, nativeEditor, dataUrlToFile(win, source, `draftferry-${index + 1}`), index, signal)
      image.setAttribute('src', url)
    } else if (!uploadedUrl(win, source)) {
      throw new Error('腾讯云市场：图片缺少有效地址，原文未改动')
    }
    index += 1
  }
  return doc.body.innerHTML
}

function signature(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html')
  return JSON.stringify({
    text: squash(doc.body.textContent),
    images: [...doc.querySelectorAll('img')].map(img => img.getAttribute('src')),
    structure: [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,table,tr,th,td,pre,ul,ol,li')].map(el => el.tagName),
  })
}

export default {
  id: 'tencent-market',
  name: '腾讯云市场',
  hosts: ['console.cloud.tencent.com'],
  format: 'html',
  match(url) {
    return hostMatches(url, this.hosts)
      && /^\/serviceprovider\/products\/createNew\/?$/.test(url.pathname)
      && url.searchParams.get('productType') === 'MARKET'
  },
  findTitle() {
    return null
  },
  findEditor(doc, win) {
    const editor = findTencentDetailEditor(doc)
    const nativeEditor = findWangEditor(editor)
    if (!nativeEditor) throw new Error('腾讯云市场：无法确认商品详情的编辑器接口，原文未改动')
    return {
      getText: () => editor.textContent ?? '',
      async setHTML(html) {
        const previous = editor.innerHTML
        const prepared = await uploadEmbeddedImages(win, nativeEditor, html, null)
        if (editor.innerHTML !== previous) throw new Error('腾讯云市场：上传期间正文发生变化，已停止导入；请重试')
        try {
          nativeEditor.txt.html(prepared)
          if (signature(nativeEditor.txt.html()) !== signature(prepared)) throw new Error('腾讯云市场：正文写入不完整，已恢复原文')
          if (typeof nativeEditor.change === 'function') nativeEditor.change()
        } catch (error) {
          nativeEditor.txt.html(previous)
          if (typeof nativeEditor.change === 'function') nativeEditor.change()
          throw error
        }
      },
    }
  },
  writeTitle: null,
}
