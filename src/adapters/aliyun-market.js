import { parseHtml } from './common.js'
import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from '../editor-content.js'
import { preservingFocus } from '../editor-lock.js'

function normalizedLabelText(element) {
  return element.textContent
    ?.replace(/\s+/g, '')
    .replace(/^[*＊]+|[：:*＊]+$/g, '') ?? ''
}

export function findAliyunDetailEditor(document, windowObject = document.defaultView) {
  const label = [...document.querySelectorAll('label')].find((element) => (
    ['产品详情', '商品详情'].includes(normalizedLabelText(element))
  ))
  const formItem = label?.closest('.acpn-form-item, .next-form-item')
  const wrapper = formItem?.querySelector('.cke[class*="cke_editor_"]')
  const instanceClass = wrapper
    ? [...wrapper.classList].find((name) => /^cke_editor_.+/.test(name))
    : null
  const instanceName = instanceClass?.replace(/^cke_editor_/, '')
  const editor = instanceName
    ? windowObject.CKEDITOR?.instances?.[instanceName]
    : null
  if (!label || !formItem || !wrapper || !editor) {
    throw new Error('阿里云市场：未找到“产品详情”CKEditor 实例')
  }
  if (
    typeof editor.getData !== 'function'
    || typeof editor.setData !== 'function'
    || typeof editor.fire !== 'function'
  ) {
    throw new Error('阿里云市场：产品详情 CKEditor 接口不完整')
  }
  return editor
}

function setCkEditorData(windowObject, editor, html) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      windowObject.clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = windowObject.setTimeout(
      () => finish(new Error('阿里云市场：产品详情编辑器响应超时')),
      5000,
    )
    try {
      editor.setData(html, { callback: () => finish() })
    } catch (error) {
      finish(error)
    }
  })
}

function isUploadedImageSource(document, source) {
  if (!/^(?:https?:)?\/\//i.test(source)) return false
  try {
    return /^https?:$/.test(new document.defaultView.URL(source, document.location.href).protocol)
  } catch {
    return false
  }
}

function imageState(document, html) {
  const container = parseHtml(document, html)
  const images = [...container.querySelectorAll('img')]
  const sources = images.map((image) => image.getAttribute('src')?.trim() ?? '')
  return {
    count: images.length,
    embeddedCount: sources.filter((source) => /^data:image\//i.test(source)).length,
    pending: images.some((image) => (
      /^(?:data:image\/|blob:)/i.test(image.getAttribute('src')?.trim() ?? '')
      || /^(?:data:image\/|blob:)/i.test(image.getAttribute('data-cke-saved-src')?.trim() ?? '')
    )),
    valid: sources.every((source) => isUploadedImageSource(document, source)),
  }
}

async function waitForCloudImages(windowObject, readHtml, expectedCount, platformName, timeoutMs, assertCurrent = () => {}) {
  if (expectedCount === 0) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    assertCurrent()
    const state = imageState(windowObject.document, readHtml())
    if (state.count >= expectedCount && !state.pending && state.valid) return
    await new Promise((resolve) => windowObject.setTimeout(resolve, 100))
  }
  throw new Error(`${platformName}：内嵌图片没有完成平台上传`)
}

function abortAliyunUploads(editor) {
  const loaders = Object.values(editor.uploadRepository?.loaders ?? {})
  for (const loader of loaders) loader.abort?.()
}

function observeAliyunUploadResponses(windowObject, editor, expectedCount, timeoutMs, signal) {
  if (expectedCount === 0) {
    return { promise: Promise.resolve(), cancel() {} }
  }
  if (typeof editor.on !== 'function' || typeof editor.removeListener !== 'function') {
    throw new Error('阿里云市场：无法监听产品详情图片上传状态')
  }
  let cancel = () => {}
  const promise = new Promise((resolve, reject) => {
    let completed = 0
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      windowObject.clearTimeout(timer)
      editor.removeListener('fileUploadResponse', onResponse)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    cancel = () => finish()
    const onAbort = () => finish(new DOMException('已停止导入', 'AbortError'))
    const onResponse = (event) => {
      const status = event?.data?.fileLoader?.xhr?.status
      const message = event?.data?.message
      if (message || (Number.isFinite(status) && status >= 400)) {
        finish(new Error(`阿里云市场：图片上传失败${message ? `：${message}` : `（HTTP ${status}）`}`))
        return
      }
      completed += 1
      if (completed >= expectedCount) finish()
    }
    const timer = windowObject.setTimeout(
      () => finish(new Error('阿里云市场：图片上传响应超时')),
      timeoutMs,
    )
    editor.on('fileUploadResponse', onResponse)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
  return { promise, cancel }
}

export async function injectAliyunMarket(document, article, options) {
  const windowObject = options.pageWindow ?? document.defaultView
  const editor = findAliyunDetailEditor(document, windowObject)
  const previousHtml = editor.getData() ?? ''
  confirmPotentialOverwrite(
    windowObject,
    hasMeaningfulEditorContent(parseHtml(document, previousHtml)),
  )
  const articleImages = imageState(document, article.html)
  const expectedImages = articleImages.count
  let uploadObservation
  try {
    await setCkEditorData(windowObject, editor, '')
    options.assertCurrent?.()
    uploadObservation = observeAliyunUploadResponses(
      windowObject,
      editor,
      articleImages.embeddedCount,
      options.imageUploadTimeoutMs ?? 30_000,
      options.signal,
    )
    preservingFocus(windowObject, () => {
      editor.focus?.()
      editor.fire('paste', {
        type: 'html',
        method: 'paste',
        dataValue: article.html,
      })
    })
    await uploadObservation.promise
    options.assertCurrent?.()
    await waitForCloudImages(
      windowObject,
      () => editor.getData() ?? '',
      expectedImages,
      '阿里云市场',
      options.imageUploadTimeoutMs ?? 30_000,
      options.assertCurrent,
    )
  } catch (error) {
    uploadObservation?.cancel()
    abortAliyunUploads(editor)
    options.assertTargetCurrent?.()
    try {
      await setCkEditorData(windowObject, editor, previousHtml)
      if ((editor.getData() ?? '') !== previousHtml) {
        throw new Error('恢复后内容与原产品详情不一致', { cause: error })
      }
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        '阿里云市场：导入失败，且无法恢复原产品详情；请刷新页面且不要保存',
        { cause: restoreError },
      )
    }
    throw error
  }
  return {
    platformId: 'aliyun-market',
    titleFilled: false,
    bodyFilled: true,
    mode: 'html-paste',
  }
}
