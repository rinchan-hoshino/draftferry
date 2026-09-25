import { collectOpenEditorRoots } from './dom-roots.js'
import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from './editor-content.js'
import { preservingFocus, withEditorLock } from './editor-lock.js'
import { findLegacyWangEditor } from './framework-diagnostics.js'
import { dataImageUrlToBlob, imageFileExtension } from './image-data.js'

function normalizedLabelText(element) {
  return element.textContent?.replace(/\s+/g, '').replace(/^[*＊]+|[：:*＊]+$/g, '') ?? ''
}

function isTencentFormItemBoundary(element) {
  return [...element.classList].some((className) => {
    const normalized = className.toLowerCase()
    return normalized.includes('form')
      && normalized.includes('item')
      && !['control', 'label', 'editor', 'content'].some((word) => (
        normalized.includes(word)
      ))
  })
}

function isTencentDetailEditor(editor) {
  let ancestor = editor.parentElement
  for (
    let depth = 0;
    ancestor && ancestor !== editor.ownerDocument.body && depth < 6;
    depth += 1
  ) {
    const hasLabel = [...ancestor.querySelectorAll('label, span, div')].some((element) => (
      element !== editor
      && !editor.contains(element)
      && normalizedLabelText(element) === '商品详情'
    ))
    if (hasLabel) return true
    if (isTencentFormItemBoundary(ancestor)) return false
    ancestor = ancestor.parentElement
  }
  return false
}

function hasRenderedBox(element) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isAvailableEditor(editor) {
  if (editor.closest('[hidden], [aria-hidden="true"], [inert]')) return false
  let element = editor
  while (element) {
    const style = editor.ownerDocument.defaultView.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    element = element.parentElement ?? element.getRootNode()?.host
  }
  return true
}

function isVisuallyAssociatedTencentField(label, editor) {
  if (!hasRenderedBox(label) || !hasRenderedBox(editor)) return false
  const labelRect = label.getBoundingClientRect()
  const editorRect = editor.getBoundingClientRect()
  const verticalOverlap = Math.min(labelRect.bottom, editorRect.bottom)
    - Math.max(labelRect.top, editorRect.top)
  const rowGap = Math.max(0, editorRect.left - labelRect.right)
  const sameRow = verticalOverlap > 0
    && labelRect.right <= editorRect.right
    && rowGap <= 400
  const horizontalOverlap = Math.min(labelRect.right, editorRect.right)
    - Math.max(labelRect.left, editorRect.left)
  const columnGap = editorRect.top - labelRect.bottom
  const stacked = horizontalOverlap > 0 && columnGap >= 0 && columnGap <= 120
  return sameRow || stacked
}

export function findTencentDetailEditor(document) {
  const matches = new Set()
  for (const root of collectOpenEditorRoots(document)) {
    const allEditors = [...root.querySelectorAll('.w-e-text[contenteditable="true"]')]
      .filter(isAvailableEditor)
    for (const editor of allEditors.filter(isTencentDetailEditor)) matches.add(editor)

    const detailLabels = [...root.querySelectorAll('label, span, div')].filter((element) => (
      normalizedLabelText(element) === '商品详情'
      && (element.matches('label, span') || element.children.length === 0)
    ))
    for (const editor of allEditors) {
      if (detailLabels.some((label) => isVisuallyAssociatedTencentField(label, editor))) {
        matches.add(editor)
      }
    }
  }
  if (matches.size === 1) return [...matches][0]
  throw new Error('腾讯云市场：未找到唯一且标注为“商品详情”的编辑器')
}

function uploadedUrl(windowObject, source) {
  if (typeof source !== 'string' || !/^(?:https?:)?\/\//i.test(source.trim())) return null
  try {
    const url = new windowObject.URL(source, windowObject.location.href)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch { return null }
}

function uploadImage(windowObject, nativeEditor, file, index, timeoutMs, signal) {
  const config = nativeEditor.config
  if (!config || (typeof config.customUploadImg !== 'function' && !config.uploadImgServer)) {
    throw new Error('腾讯云市场：无法取得商品详情的图片上传配置，原文未改动；请下载诊断')
  }
  const extension = file.name.split('.').pop().toLowerCase()
  if (!file.size || (config.uploadImgMaxSize && file.size > config.uploadImgMaxSize)
    || (Array.isArray(config.uploadImgAccept) && !config.uploadImgAccept.includes(extension))) {
    throw new Error(`腾讯云市场：第 ${index + 1} 张图片不符合平台大小或格式限制，原文未改动`)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let request
    const finish = (error, url) => {
      if (settled) return
      settled = true
      windowObject.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) {
        request?.abort()
        reject(error)
      } else resolve(url)
    }
    const fail = () => finish(new Error(`腾讯云市场：第 ${index + 1} 张图片上传失败，原文未改动；请重试`))
    const onAbort = () => finish(new Error('页面已切换，已停止导入'))
    const timer = windowObject.setTimeout(() => finish(new Error(
      `腾讯云市场：第 ${index + 1} 张内嵌图片上传超时，原文未改动`,
    )), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    // The documented custom uploader receives a URL callback, not a DOM target.
    // Never pass wangEditor's live insertImg: even late callbacks can only
    // complete this upload, and cannot insert at a stale editor selection.
    const receiveUrl = (source) => {
      if (settled) return
      const url = uploadedUrl(windowObject, source)
      finish(url ? null : new Error('腾讯云市场：图片上传未返回有效地址，原文未改动'), url)
    }
    try {
      if (signal?.aborted) { onAbort(); return }
      if (typeof config.customUploadImg === 'function') {
        const pending = config.customUploadImg([file], receiveUrl)
        pending?.catch?.(fail)
        return
      }
      // For the built-in uploader, honor the same documented request settings
      // and response/customInsert contract with a request owned by this job.
      const endpoint = new windowObject.URL(config.uploadImgServer, windowObject.location.href)
      if (!/^https?:$/.test(endpoint.protocol)) { fail(); return }
      const body = new windowObject.FormData()
      body.append(config.uploadFileName || file.name, file)
      for (const [key, value] of Object.entries(config.uploadImgParams ?? {})) {
        body.append(key, value)
        if (config.uploadImgParamsWithUrl) endpoint.searchParams.append(key, value)
      }
      const hooks = config.uploadImgHooks ?? {}
      request = new windowObject.XMLHttpRequest()
      request.open('POST', endpoint.href)
      request.withCredentials = Boolean(config.withCredentials)
      request.timeout = Math.min(config.uploadImgTimeout || timeoutMs, timeoutMs)
      for (const [key, value] of Object.entries(config.uploadImgHeaders ?? {})) request.setRequestHeader(key, value)
      request.onerror = fail
      request.ontimeout = fail
      request.onabort = fail
      request.onload = () => {
        if (settled) return
        try {
          if (request.status < 200 || request.status >= 300) { fail(); return }
          const result = JSON.parse(request.responseText)
          if (typeof hooks.customInsert === 'function') {
            hooks.customInsert(receiveUrl, result, nativeEditor)
          } else if (String(result.errno) === '0' && Array.isArray(result.data) && result.data.length === 1) {
            receiveUrl(typeof result.data[0] === 'string' ? result.data[0] : result.data[0]?.url)
            hooks.success?.(request, nativeEditor, result)
          } else fail()
        } catch { fail() }
      }
      const veto = hooks.before?.(request, nativeEditor, [file])
      if (typeof veto === 'string' || veto === false) { fail(); return }
      request.send(body)
    } catch (error) { finish(error) }
  })
}

async function prepareHtml(editor, nativeEditor, article, options, assertCurrent) {
  const document = editor.ownerDocument
  const windowObject = document.defaultView
  const content = document.createElement('div')
  content.innerHTML = article.html
  const uploaded = new Map()
  for (const image of content.querySelectorAll('img')) {
    assertCurrent()
    const source = image.getAttribute('src')?.trim() ?? ''
    if (/^data:image\//i.test(source)) {
      if (!uploaded.has(source)) {
        const blob = dataImageUrlToBlob(windowObject, source, '腾讯云市场')
        const file = new windowObject.File([blob], `draftferry-${uploaded.size + 1}.${imageFileExtension(blob.type)}`, { type: blob.type })
        options.onProgress?.(`正在上传第 ${uploaded.size + 1} 张图片，商品详情暂时锁定…`)
        uploaded.set(source, await uploadImage(
          windowObject, nativeEditor, file, uploaded.size,
          options.imageUploadTimeoutMs ?? 30_000, options.signal,
        ))
      }
      image.setAttribute('src', uploaded.get(source))
    } else if (!uploadedUrl(windowObject, source)) {
      throw new Error('腾讯云市场：图片缺少有效地址，原文未改动')
    }
  }
  return content.innerHTML
}

function contentSignature(document, html) {
  const content = document.createElement('div')
  content.innerHTML = html
  return JSON.stringify({
    text: content.textContent.replace(/[\s\u200b]/g, ''),
    images: [...content.querySelectorAll('img')].map((image) => image.getAttribute('src')),
    structure: [...content.querySelectorAll('h1,h2,h3,h4,h5,h6,table,tr,th,td,pre,ul,ol,li')]
      .map((element) => element.tagName),
  })
}

export async function injectTencentMarket(document, article, options = {}) {
  const editor = findTencentDetailEditor(document)
  const nativeEditor = findLegacyWangEditor(editor)
  if (!nativeEditor) {
    throw new Error('腾讯云市场：无法确认商品详情的编辑器接口，原文未改动；请从更多菜单下载诊断')
  }
  const windowObject = editor.ownerDocument.defaultView
  const toolbar = nativeEditor.$toolbarElem?.elems?.[0]
  return withEditorLock([editor, toolbar], async (assertCurrent) => {
    confirmPotentialOverwrite(windowObject, hasMeaningfulEditorContent(editor))
    const previousHtml = editor.innerHTML
    const preparedHtml = await prepareHtml(editor, nativeEditor, article, options, assertCurrent)
    assertCurrent()
    if (editor.innerHTML !== previousHtml) {
      throw new Error('腾讯云市场：上传期间正文发生变化，已停止导入；请重试')
    }
    preservingFocus(windowObject, () => {
      try {
        nativeEditor.txt.html(preparedHtml)
        if (contentSignature(editor.ownerDocument, nativeEditor.txt.html())
          !== contentSignature(editor.ownerDocument, preparedHtml)) {
          throw new Error('腾讯云市场：正文写入不完整，已恢复原文')
        }
      } catch (error) {
        try {
          nativeEditor.txt.html(previousHtml)
          if (contentSignature(editor.ownerDocument, nativeEditor.txt.html())
            !== contentSignature(editor.ownerDocument, previousHtml)) {
            throw new Error('恢复后的正文与原文不一致', { cause: error })
          }
        } catch (restoreError) {
          throw new AggregateError([error, restoreError], '腾讯云市场：无法恢复原文，请刷新页面且不要保存', { cause: restoreError })
        }
        throw error
      }
    })
    return { platformId: 'tencent-market', titleFilled: false, bodyFilled: true, mode: 'html-api' }
  }, { ...options, freezeContentEditable: true })
}
