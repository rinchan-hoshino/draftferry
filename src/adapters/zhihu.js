import { parseHtml, queryFirst, readControlValue, writeControl } from './common.js'
import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from '../editor-content.js'
import { preservingFocus } from '../editor-lock.js'
import { dataImageUrlToBlob, imageFileExtension } from '../image-data.js'

function isActionableButton(button) {
  return (
    !button.disabled
    && !button.hidden
    && button.getAttribute('aria-hidden') !== 'true'
    && button.style.display !== 'none'
  )
}

async function waitForButton(
  windowObject,
  predicate,
  timeoutMs,
  excluded = new Set(),
  root = windowObject.document,
  signal,
) {
  const find = () => [...root.querySelectorAll('button')].find((button) => (
    !excluded.has(button)
    && isActionableButton(button)
    && predicate(button.textContent?.trim() ?? '')
  ))
  const immediate = find()
  if (immediate) return immediate
  return new Promise((resolve, reject) => {
    const finish = (button, error) => {
      observer.disconnect()
      windowObject.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(button)
    }
    const abort = () => finish(null, new DOMException('已停止导入', 'AbortError'))
    const observer = new windowObject.MutationObserver(() => {
      const button = find()
      if (button) finish(button)
    })
    observer.observe(root, { childList: true, subtree: true })
    const timer = windowObject.setTimeout(() => {
      finish(find() ?? null)
    }, timeoutMs)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

async function uploadZhihuDataImage(windowObject, source, index, signal) {
  const blob = dataImageUrlToBlob(windowObject, source, '知乎')
  const formData = new windowObject.FormData()
  const extension = imageFileExtension(blob.type)
  formData.append('picture', blob, `draftferry-${index + 1}.${extension}`)
  formData.append('source', 'article')
  const response = await windowObject.fetch(
    'https://zhuanlan.zhihu.com/api/uploaded_images',
    {
      method: 'POST',
      signal,
      credentials: 'include',
      headers: { 'x-requested-with': 'fetch' },
      body: formData,
    },
  )
  if (!response.ok) {
    throw new Error(`知乎：图片上传失败（HTTP ${response.status}）`)
  }
  const result = await response.json()
  const uploadedSource = typeof result?.src === 'string' ? result.src.trim() : ''
  if (!uploadedSource) {
    throw new Error('知乎：图片上传响应没有有效地址')
  }
  const uploadedUrl = new windowObject.URL(uploadedSource, windowObject.location.href)
  if (!/^https?:$/.test(uploadedUrl.protocol)) {
    throw new Error('知乎：图片上传响应没有有效地址')
  }
  return uploadedUrl.href
}

async function prepareZhihuMarkdown(
  document,
  article,
  windowObject = document.defaultView,
  options = {},
) {
  const container = parseHtml(document, article.html)
  const sources = [...container.querySelectorAll('img')]
    .map((image) => image.getAttribute('src')?.trim() ?? '')
    .filter((source) => /^data:image\//i.test(source))
  let markdown = article.portableMarkdown
  const uploadedUrls = options.uploadCache ?? new Map()
  for (const source of sources) {
    options.assertCurrent?.()
    if (!markdown.includes(source)) {
      throw new Error('知乎：无法在 Markdown 中定位内嵌图片')
    }
    if (!uploadedUrls.has(source)) {
      options.onAssetProgress?.({ source, status: 'uploading' })
      options.onProgress?.(`正在上传 ${options.assetNames?.get(source) ?? '图片'}…`)
      try {
        const url = await uploadZhihuDataImage(windowObject, source, uploadedUrls.size, options.signal)
        options.assertCurrent?.()
        uploadedUrls.set(source, url)
      } catch (error) {
        options.onAssetProgress?.({ source, status: 'failed' })
        throw error
      }
    }
    options.onAssetProgress?.({ source, status: 'uploaded' })
    markdown = markdown.replaceAll(source, uploadedUrls.get(source))
  }
  return markdown
}

export async function injectZhihu(document, article, options) {
  const windowObject = options.pageWindow ?? document.defaultView
  const titleControl = queryFirst(document, ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'])
  const editor = queryFirst(document, ['.public-DraftEditor-content[contenteditable="true"]', '.DraftEditor-root [contenteditable="true"]'])
  if (!titleControl || !editor) throw new Error('知乎：未找到标题或正文编辑器')
  confirmPotentialOverwrite(
    windowObject,
    Boolean(readControlValue(titleControl).trim() || hasMeaningfulEditorContent(editor)),
  )
  if (!windowObject.DataTransfer || !windowObject.ClipboardEvent || typeof document.execCommand !== 'function') {
    throw new Error('知乎：浏览器缺少 Markdown 粘贴或 undo 接口')
  }
  const previousTitle = readControlValue(titleControl)
  let pasteDispatched = false
  try {
    const markdown = await prepareZhihuMarkdown(document, article, windowObject, options)
    options.assertCurrent?.()
    const transfer = new windowObject.DataTransfer()
    transfer.setData('text/plain', markdown)
    const buttonsBeforePaste = new Set(
      [...document.querySelectorAll('button')].filter(isActionableButton),
    )
    preservingFocus(windowObject, () => {
      editor.focus({ preventScroll: true })
      editor.dispatchEvent(new windowObject.ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }))
    })
    pasteDispatched = true
    const timeoutMs = options.waitTimeoutMs ?? 5000
    const parseButton = await waitForButton(
      windowObject,
      (text) => text.includes('确认并解析'),
      timeoutMs,
      buttonsBeforePaste,
      document,
      options.signal,
    )
    if (!parseButton) throw new Error('知乎：没有出现“确认并解析”')
    options.assertCurrent?.()
    const parseDialog = parseButton.closest([
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.Modal-wrapper',
      '.Modal',
      '[class*="Modal"]',
      '[class*="modal"]',
      '[class*="Dialog"]',
      '[class*="dialog"]',
    ].join(', '))
    if (!parseDialog) throw new Error('知乎：无法确认 Markdown 解析弹窗边界')
    const buttonsBeforeParse = new Set(
      [...parseDialog.querySelectorAll('button')].filter(isActionableButton),
    )
    parseButton.click()
    const confirmButton = await waitForButton(
      windowObject,
      (text) => text === '确认',
      timeoutMs,
      buttonsBeforeParse,
      parseDialog,
      options.signal,
    )
    if (!confirmButton) throw new Error('知乎：没有出现解析后的“确认”')
    options.assertCurrent?.()
    confirmButton.click()
    writeControl(windowObject, titleControl, article.title)
  } catch (error) {
    options.assertTargetCurrent?.()
    writeControl(windowObject, titleControl, previousTitle)
    if (pasteDispatched) {
      preservingFocus(windowObject, () => {
        editor.focus({ preventScroll: true })
        document.execCommand('undo', false)
      })
    }
    throw error
  }
  return { platformId: 'zhihu', titleFilled: Boolean(article.title), bodyFilled: true, mode: 'markdown-import' }
}
