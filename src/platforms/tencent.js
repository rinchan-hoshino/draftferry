import { collectOpenRoots, isUsable, scanFrameworkInstances, squash } from '../dom.js'
import { hostMatches } from './shared.js'

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

export function findWangEditor(target) {
  if (!target || target.isConnected === false) return null
  const found = scanFrameworkInstances(target, (obj) => {
    if (typeof obj.txt?.html !== 'function' || !obj.$textElem) return false
    const first = obj.$textElem.elems?.[0] ?? obj.$textElem[0]
    return first === target && first.isConnected !== false
  })
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

function uploadOne(win, nativeEditor, file, index, signal) {
  const config = nativeEditor.config ?? {}
  if (typeof config.customUploadImg !== 'function' && !config.uploadImgServer) {
    throw new Error('腾讯云市场：无法取得商品详情的图片上传配置，原文未改动')
  }
  const ext = file.name.split('.').pop().toLowerCase()
  if (!file.size || (config.uploadImgMaxSize && file.size > config.uploadImgMaxSize)
    || (Array.isArray(config.uploadImgAccept) && !config.uploadImgAccept.includes(ext))) {
    throw new Error(`腾讯云市场：第 ${index + 1} 张图片不符合平台大小或格式限制，原文未改动`)
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
      } else {
        resolve(url)
      }
    }
    const onAbort = () => finish(new Error('页面已切换，已停止导入'))
    const fail = () => finish(new Error(`腾讯云市场：第 ${index + 1} 张图片上传失败，原文未改动；请重试`))
    const timer = win.setTimeout(() => finish(new Error(`腾讯云市场：第 ${index + 1} 张内嵌图片上传超时，原文未改动`)), UPLOAD_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    const receiveUrl = (source) => {
      if (settled) return
      const url = uploadedUrl(win, source)
      finish(url ? null : new Error('腾讯云市场：图片上传未返回有效地址，原文未改动'), url)
    }
    try {
      if (signal?.aborted) { onAbort(); return }
      if (typeof config.customUploadImg === 'function') {
        config.customUploadImg([file], receiveUrl)?.catch?.(fail)
        return
      }
      const endpoint = new win.URL(config.uploadImgServer, win.location.href)
      if (!/^https?:$/.test(endpoint.protocol)) { fail(); return }
      const body = new win.FormData()
      body.append(config.uploadFileName || file.name, file)
      for (const [key, value] of Object.entries(config.uploadImgParams ?? {})) {
        body.append(key, value)
        if (config.uploadImgParamsWithUrl) endpoint.searchParams.append(key, value)
      }
      const hooks = config.uploadImgHooks ?? {}
      request = new win.XMLHttpRequest()
      request.open('POST', endpoint.href)
      request.withCredentials = Boolean(config.withCredentials)
      request.timeout = Math.min(config.uploadImgTimeout || UPLOAD_TIMEOUT_MS, UPLOAD_TIMEOUT_MS)
      for (const [key, value] of Object.entries(config.uploadImgHeaders ?? {})) request.setRequestHeader(key, value)
      request.onerror = fail
      request.ontimeout = fail
      request.onabort = fail
      request.onload = () => {
        if (settled) return
        try {
          if (request.status < 200 || request.status >= 300) return fail()
          const result = JSON.parse(request.responseText)
          if (typeof hooks.customInsert === 'function') {
            hooks.customInsert(receiveUrl, result, nativeEditor)
          } else if (String(result.errno) === '0' && Array.isArray(result.data) && result.data.length === 1) {
            receiveUrl(typeof result.data[0] === 'string' ? result.data[0] : result.data[0]?.url)
            hooks.success?.(request, nativeEditor, result)
          } else {
            fail()
          }
        } catch {
          fail()
        }
      }
      const veto = hooks.before?.(request, nativeEditor, [file])
      if (typeof veto === 'string' || veto === false || veto?.prevent) { fail(); return }
      request.send(body)
    } catch (error) {
      finish(error)
    }
  })
}

async function uploadEmbeddedImages(win, nativeEditor, html, onProgress) {
  const doc = win.document.implementation.createHTMLDocument('')
  doc.body.innerHTML = html
  const images = [...doc.querySelectorAll('img')]
  const uniqueSources = [...new Set(
    images.map(img => img.getAttribute('src')?.trim() ?? '').filter(src => /^data:image\//i.test(src)),
  )]
  const uploaded = new Map()
  for (const [i, source] of uniqueSources.entries()) {
    onProgress?.(`上传图片 ${i + 1}/${uniqueSources.length}…`)
    const file = dataUrlToFile(win, source, `draftferry-${i + 1}`)
    uploaded.set(source, await uploadOne(win, nativeEditor, file, i, null))
  }
  for (const image of images) {
    const source = image.getAttribute('src')?.trim() ?? ''
    if (/^data:image\//i.test(source)) {
      image.setAttribute('src', uploaded.get(source))
    } else if (!uploadedUrl(win, source)) {
      throw new Error('腾讯云市场：图片缺少有效地址，原文未改动')
    }
  }
  return doc.body.innerHTML
}

function signature(doc, html) {
  const container = doc.createElement('div')
  container.innerHTML = html
  return JSON.stringify({
    text: squash(container.textContent),
    images: [...container.querySelectorAll('img')].map(img => img.getAttribute('src')),
    structure: [...container.querySelectorAll('h1,h2,h3,h4,h5,h6,table,tr,th,td,pre,ul,ol,li')].map(el => el.tagName),
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
      async setHTML(html, { onProgress } = {}) {
        const previous = editor.innerHTML
        const prepared = await uploadEmbeddedImages(win, nativeEditor, html, onProgress)
        if (editor.innerHTML !== previous) throw new Error('腾讯云市场：上传期间正文发生变化，已停止导入；请重试')
        onProgress?.('写入正文…')
        try {
          nativeEditor.txt.html(prepared)
          if (signature(doc, nativeEditor.txt.html()) !== signature(doc, prepared)) {
            throw new Error('腾讯云市场：正文写入不完整，已恢复原文')
          }
          if (typeof nativeEditor.change === 'function') nativeEditor.change()
        } catch (error) {
          try {
            nativeEditor.txt.html(previous)
            if (typeof nativeEditor.change === 'function') nativeEditor.change()
          } catch (restoreError) {
            throw new AggregateError([error, restoreError], '腾讯云市场：无法恢复原文，请刷新页面且不要保存', { cause: restoreError })
          }
          throw error
        }
      },
    }
  },
  writeTitle: null,
}
