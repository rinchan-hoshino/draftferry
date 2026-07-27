import {
  confirmPotentialOverwrite,
  hasMeaningfulEditorContent,
  injectSohuArticle,
} from './core.js'

const PLATFORMS = [
  { id: 'zhihu', name: '知乎', hosts: ['zhihu.com'] },
  {
    id: 'wechat',
    name: '微信公众号',
    hosts: ['mp.weixin.qq.com'],
    editorUrl: (url) => (
      /^\/cgi-bin\/appmsg\/?$/.test(url.pathname)
      && url.searchParams.get('t') === 'media/appmsg_edit_v2'
    ),
  },
  { id: 'oschina', name: '开源中国', hosts: ['oschina.net'] },
  {
    id: 'baijiahao',
    name: '百家号',
    hosts: ['baijiahao.baidu.com'],
    editorPath: /^\/builder\/rc\/edit\/?$/,
  },
  {
    id: 'toutiao',
    name: '今日头条',
    hosts: ['toutiao.com'],
    editorPath: /^\/profile_v4\/graphic\/publish\/?$/,
  },
  {
    id: 'sohu',
    name: '搜狐号',
    hosts: ['mp.sohu.com'],
    editorPath: /^\/mpfe\/v4\/contentManagement\/news\/addarticle\/?$/,
  },
  {
    id: 'aliyun-market',
    name: '阿里云市场',
    hosts: ['msp.aliyun.com'],
    editorUrl: (url) => (
      /^\/msp\/commodity\/list\/~\/publish\/basic\/?$/.test(url.pathname)
      && Boolean(url.searchParams.get('commodityId'))
    ),
  },
  {
    id: 'tencent-market',
    name: '腾讯云市场',
    hosts: ['console.cloud.tencent.com'],
    editorUrl: (url) => (
      /^\/serviceprovider\/products\/createNew\/?$/.test(url.pathname)
      && url.searchParams.get('productType') === 'MARKET'
    ),
  },
]

export const PLATFORM_IDS = PLATFORMS.map((platform) => platform.id)

export function getPlatformById(id) {
  return PLATFORMS.find((platform) => platform.id === id) ?? null
}

function hostnameMatches(hostname, expected) {
  return hostname === expected || hostname.endsWith(`.${expected}`)
}

export function detectPlatform(url) {
  const normalizedUrl = url.searchParams ? url : new URL(url.href)
  return PLATFORMS.find((platform) => (
    platform.hosts.some((host) => hostnameMatches(normalizedUrl.hostname, host))
    && (!platform.editorPath || platform.editorPath.test(normalizedUrl.pathname))
    && (!platform.editorUrl || platform.editorUrl(normalizedUrl))
  )) ?? null
}

function queryFirst(document, selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      return element
    }
  }
  return null
}

function readControlValue(control) {
  if ('value' in control) {
    return control.value
  }
  return control.textContent ?? ''
}

function nativeValueSetter(windowObject, control) {
  if (control instanceof windowObject.HTMLTextAreaElement) {
    return Object.getOwnPropertyDescriptor(
      windowObject.HTMLTextAreaElement.prototype,
      'value',
    )?.set
  }
  if (control instanceof windowObject.HTMLInputElement) {
    return Object.getOwnPropertyDescriptor(
      windowObject.HTMLInputElement.prototype,
      'value',
    )?.set
  }
  return null
}

function writeControl(windowObject, control, value, notify = true) {
  const setter = nativeValueSetter(windowObject, control)
  if (setter) {
    setter.call(control, value)
  } else if ('value' in control) {
    control.value = value
  } else {
    control.textContent = value
  }
  if (notify) {
    control.dispatchEvent(new windowObject.Event('input', { bubbles: true }))
    control.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
  }
}

function readBodyValue(editor) {
  if ('value' in editor) {
    return editor.value
  }
  return editor.textContent ?? ''
}

function writeBodyValue(windowObject, editor, value, notify = true) {
  const setter = nativeValueSetter(windowObject, editor)
  if (setter) {
    setter.call(editor, value)
  } else if ('value' in editor) {
    editor.value = value
  } else {
    editor.textContent = value
  }
  if (notify) {
    editor.dispatchEvent(new windowObject.Event('input', { bubbles: true }))
    editor.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
  }
}

function confirmTextEditorOverwrite(windowObject, titleControl, bodyEditor) {
  const bodyHasContent = 'value' in bodyEditor
    ? readBodyValue(bodyEditor).trim() !== ''
    : hasMeaningfulEditorContent(bodyEditor)
  confirmPotentialOverwrite(
    windowObject,
    Boolean(readControlValue(titleControl).trim() || bodyHasContent),
  )
}

async function injectMarkdownTextEditor(
  document,
  article,
  config,
  windowObject = document.defaultView,
) {
  if (config.preflight) {
    config.preflight(document)
  }
  const titleControl = queryFirst(document, config.titleSelectors)
  const bodyEditor = queryFirst(document, config.bodySelectors)
  if (!titleControl) {
    throw new Error(`${config.name}：未找到标题输入框`)
  }
  if (!bodyEditor) {
    throw new Error(`${config.name}：未找到 Markdown 编辑器`)
  }
  confirmTextEditorOverwrite(windowObject, titleControl, bodyEditor)

  writeBodyValue(windowObject, bodyEditor, article.portableMarkdown)
  writeControl(windowObject, titleControl, article.title)

  return {
    platformId: config.id,
    titleFilled: Boolean(article.title),
    bodyFilled: true,
    mode: 'markdown',
  }
}

function parseHtml(document, html) {
  const container = document.createElement('div')
  container.innerHTML = html
  return container
}

function prepareWechatHtml(document, html) {
  const container = parseHtml(document, html)
  for (const item of container.querySelectorAll('li')) {
    if (!hasMeaningfulEditorContent(item)) {
      item.remove()
    }
  }
  for (const list of container.querySelectorAll('ol, ul')) {
    for (const node of [...list.childNodes]) {
      if (node.nodeType === 3 && !node.textContent.trim()) {
        node.remove()
      }
    }
    if (!list.querySelector('li')) {
      list.remove()
    }
  }
  return container.innerHTML
}

function pickWechatBodyEditor(document) {
  const titleEditor = document.querySelector('.title-editor__input .ProseMirror')
  const candidates = [...document.querySelectorAll('.ProseMirror')]
    .filter((editor) => editor !== titleEditor && !editor.closest('.title-editor__input'))
  return candidates.find((editor) => (
    editor.textContent?.includes('从这里开始写正文')
  )) ?? candidates[0] ?? null
}

function invokeWechatEditor(windowObject, html) {
  const invoke = windowObject.__MP_Editor_JSAPI__?.invoke
  if (typeof invoke !== 'function') {
    throw new Error('微信公众号：未找到 mp_editor_set_content 接口，待真实页面确认')
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    try {
      invoke({
        apiName: 'mp_editor_set_content',
        apiParam: { content: html },
        sucCb: () => finish(),
        errCb: (error) => finish(new Error(
          `微信公众号：内容接口失败：${error?.message ?? String(error)}`,
        )),
      })
    } catch (error) {
      finish(error)
    }
    windowObject.setTimeout(() => finish(new Error('微信公众号：内容接口调用超时')), 5000)
  })
}

async function injectWechat(document, article, windowObject = document.defaultView) {
  const titleControl = document.querySelector('#title')
  const bodyEditor = pickWechatBodyEditor(document)
  if (!titleControl || !bodyEditor) {
    throw new Error('微信公众号：未找到标题或正文编辑器')
  }
  confirmPotentialOverwrite(
    windowObject,
    Boolean(
      readControlValue(titleControl).trim()
      || hasMeaningfulEditorContent(bodyEditor)
    ),
  )
  if (typeof windowObject.__MP_Editor_JSAPI__?.invoke !== 'function') {
    throw new Error('微信公众号：未找到 mp_editor_set_content 接口，待真实页面确认')
  }

  const preparedHtml = prepareWechatHtml(document, article.html)
  await invokeWechatEditor(windowObject, preparedHtml)
  writeControl(windowObject, titleControl, article.title)

  return {
    platformId: 'wechat',
    titleFilled: Boolean(article.title),
    bodyFilled: true,
    mode: 'html-api',
  }
}

function findBaijiahaoTitle(document) {
  return queryFirst(document, [
    '.client_components_titleInput [contenteditable="true"]',
    '.client_pages_edit_components_titleInput [contenteditable="true"]',
    '[class*="titleInput"] [contenteditable="true"]',
  ])
}

async function injectBaijiahao(document, article, windowObject = document.defaultView) {
  const titleControl = findBaijiahaoTitle(document)
  const editor = windowObject.UE_V2?.instants?.ueditorInstant0
  if (!titleControl) throw new Error('百家号：未找到标题编辑器')
  if (!editor || typeof editor.getContent !== 'function' || typeof editor.setContent !== 'function') {
    throw new Error('百家号：未找到 UEditor 状态接口')
  }

  const currentTitle = readControlValue(titleControl)
  const currentHtml = editor.getContent() ?? ''
  confirmPotentialOverwrite(
    windowObject,
    Boolean(currentTitle.trim() || hasMeaningfulEditorContent(parseHtml(document, currentHtml))),
  )

  editor.setContent(article.html)
  editor.fireEvent?.('contentChange')
  writeControl(windowObject, titleControl, article.title)
  return { platformId: 'baijiahao', titleFilled: Boolean(article.title), bodyFilled: true, mode: 'html-api' }
}

function selectEditorEnd(windowObject, editor) {
  const selection = windowObject.getSelection()
  const range = windowObject.document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function prepareToutiaoPastedHtml(document, html) {
  const container = parseHtml(document, html)
  for (const image of container.querySelectorAll('img')) {
    image.setAttribute('needCheck', 'true')
    image.setAttribute('paste', 'true')
  }
  return container.innerHTML
}

async function injectToutiao(document, article, windowObject = document.defaultView) {
  const titleControl = document.querySelector('textarea[placeholder*="标题"]')
  const editor = document.querySelector('.ProseMirror[contenteditable="true"], .ProseMirror')
  if (!titleControl || !editor) throw new Error('今日头条：未找到标题或正文编辑器')
  confirmPotentialOverwrite(
    windowObject,
    Boolean(readControlValue(titleControl).trim() || hasMeaningfulEditorContent(editor)),
  )
  if (typeof document.execCommand !== 'function') {
    throw new Error('今日头条：浏览器不支持 insertHTML 编辑命令')
  }
  editor.focus()
  selectEditorEnd(windowObject, editor)
  const pastedHtml = prepareToutiaoPastedHtml(document, article.html)
  const accepted = Boolean(document.execCommand('insertHTML', false, pastedHtml))
  if (!accepted) throw new Error('今日头条：编辑器拒绝 insertHTML')
  editor.dispatchEvent(new windowObject.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }))
  editor.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
  writeControl(windowObject, titleControl, article.title)
  return { platformId: 'toutiao', titleFilled: Boolean(article.title), bodyFilled: true, mode: 'html-command' }
}

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
) {
  const find = () => [...root.querySelectorAll('button')].find((button) => (
    !excluded.has(button)
    && isActionableButton(button)
    && predicate(button.textContent?.trim() ?? '')
  ))
  const immediate = find()
  if (immediate) return immediate
  return new Promise((resolve) => {
    const observer = new windowObject.MutationObserver(() => {
      const button = find()
      if (button) {
        observer.disconnect()
        windowObject.clearTimeout(timer)
        resolve(button)
      }
    })
    observer.observe(root, { childList: true, subtree: true })
    const timer = windowObject.setTimeout(() => {
      observer.disconnect()
      resolve(find() ?? null)
    }, timeoutMs)
  })
}

function dataImageUrlToBlob(windowObject, source, platformName = '知乎') {
  const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i)
  if (!match) {
    throw new Error(`${platformName}：内嵌图片不是有效的 Base64 图片`)
  }
  const binary = windowObject.atob(match[2])
  const bytes = windowObject.Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new windowObject.Blob([bytes], { type: match[1].toLowerCase() })
}

function imageFileExtension(mimeType) {
  const subtype = mimeType.split('/')[1]?.toLowerCase() ?? 'png'
  if (subtype === 'jpeg') return 'jpg'
  return subtype.replace(/[^a-z0-9]/g, '') || 'png'
}

async function uploadZhihuDataImage(windowObject, source, index) {
  const blob = dataImageUrlToBlob(windowObject, source)
  const formData = new windowObject.FormData()
  const extension = imageFileExtension(blob.type)
  formData.append('picture', blob, `draftferry-${index + 1}.${extension}`)
  formData.append('source', 'article')
  const response = await windowObject.fetch(
    'https://zhuanlan.zhihu.com/api/uploaded_images',
    {
      method: 'POST',
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
) {
  const container = parseHtml(document, article.html)
  const sources = [...container.querySelectorAll('img')]
    .map((image) => image.getAttribute('src')?.trim() ?? '')
    .filter((source) => /^data:image\//i.test(source))
  let markdown = article.portableMarkdown
  const uploadedUrls = new Map()
  for (const source of sources) {
    if (!markdown.includes(source)) {
      throw new Error('知乎：无法在 Markdown 中定位内嵌图片')
    }
    if (!uploadedUrls.has(source)) {
      uploadedUrls.set(
        source,
        await uploadZhihuDataImage(windowObject, source, uploadedUrls.size),
      )
    }
    markdown = markdown.replaceAll(source, uploadedUrls.get(source))
  }
  return markdown
}

async function injectZhihu(document, article, options) {
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
    const markdown = await prepareZhihuMarkdown(document, article, windowObject)
    const transfer = new windowObject.DataTransfer()
    transfer.setData('text/plain', markdown)
    const buttonsBeforePaste = new Set(
      [...document.querySelectorAll('button')].filter(isActionableButton),
    )
    editor.focus()
    editor.dispatchEvent(new windowObject.ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }))
    pasteDispatched = true
    const timeoutMs = options.waitTimeoutMs ?? 5000
    const parseButton = await waitForButton(
      windowObject,
      (text) => text.includes('确认并解析'),
      timeoutMs,
      buttonsBeforePaste,
    )
    if (!parseButton) throw new Error('知乎：没有出现“确认并解析”')
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
    )
    if (!confirmButton) throw new Error('知乎：没有出现解析后的“确认”')
    confirmButton.click()
    writeControl(windowObject, titleControl, article.title)
  } catch (error) {
    writeControl(windowObject, titleControl, previousTitle)
    if (pasteDispatched) {
      document.execCommand('undo', false)
    }
    throw error
  }
  return { platformId: 'zhihu', titleFilled: Boolean(article.title), bodyFilled: true, mode: 'markdown-import' }
}

function normalizedLabelText(element) {
  return element.textContent
    ?.replace(/\s+/g, '')
    .replace(/^[*＊]+|[：:*＊]+$/g, '') ?? ''
}

function findAliyunDetailEditor(document, windowObject = document.defaultView) {
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

async function waitForCloudImages(windowObject, readHtml, expectedCount, platformName, timeoutMs) {
  if (expectedCount === 0) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
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

function observeAliyunUploadResponses(windowObject, editor, expectedCount, timeoutMs) {
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
      if (error) reject(error)
      else resolve()
    }
    cancel = () => finish()
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
  })
  return { promise, cancel }
}

async function injectAliyunMarket(document, article, options) {
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
    uploadObservation = observeAliyunUploadResponses(
      windowObject,
      editor,
      articleImages.embeddedCount,
      options.imageUploadTimeoutMs ?? 30_000,
    )
    editor.focus?.()
    editor.fire('paste', {
      type: 'html',
      method: 'paste',
      dataValue: article.html,
    })
    await uploadObservation.promise
    await waitForCloudImages(
      windowObject,
      () => editor.getData() ?? '',
      expectedImages,
      '阿里云市场',
      options.imageUploadTimeoutMs ?? 30_000,
    )
  } catch (error) {
    uploadObservation?.cancel()
    abortAliyunUploads(editor)
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
    ancestor = ancestor.parentElement
  }
  return false
}

function hasRenderedBox(element) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
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

function collectOpenEditorRoots(document) {
  const roots = [document]
  const seen = new Set(roots)
  for (let index = 0; index < roots.length && roots.length < 100; index += 1) {
    const root = roots[index]
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot && !seen.has(element.shadowRoot)) {
        seen.add(element.shadowRoot)
        roots.push(element.shadowRoot)
      }
      if (element.tagName === 'IFRAME') {
        try {
          const frameDocument = element.contentDocument
          if (frameDocument && !seen.has(frameDocument)) {
            seen.add(frameDocument)
            roots.push(frameDocument)
          }
        } catch {
          // Cross-origin frames cannot expose their editor DOM to this userscript.
        }
      }
    }
  }
  return roots
}

function findTencentDetailEditor(document) {
  const matches = new Set()
  for (const root of collectOpenEditorRoots(document)) {
    const allEditors = [...root.querySelectorAll('.w-e-text[contenteditable="true"]')]
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

function dispatchTencentInput(windowObject, editor, inputType) {
  editor.dispatchEvent(new windowObject.InputEvent('input', {
    bubbles: true,
    inputType,
  }))
}

function selectTencentEditor(windowObject, editor, collapseToEnd = false) {
  editor.focus()
  const selection = windowObject.getSelection()
  const range = windowObject.document.createRange()
  range.selectNodeContents(editor)
  range.collapse(collapseToEnd)
  selection.removeAllRanges()
  selection.addRange(range)
}

function formDataContainsFile(windowObject, body, fileName) {
  return body instanceof windowObject.FormData && [...body.values()].some((value) => (
    value instanceof windowObject.File && value.name === fileName
  ))
}

function captureTencentUploadRequests(windowObject, fileName) {
  const requests = []
  const controllers = []
  const xhrPrototype = windowObject.XMLHttpRequest?.prototype
  const originalSend = xhrPrototype?.send
  const originalFetch = windowObject.fetch
  if (originalSend) {
    xhrPrototype.send = function (body) {
      if (formDataContainsFile(windowObject, body, fileName)) requests.push(this)
      return originalSend.call(this, body)
    }
  }
  if (typeof originalFetch === 'function' && windowObject.AbortController) {
    windowObject.fetch = (input, init = {}) => {
      if (init.signal || !formDataContainsFile(windowObject, init.body, fileName)) {
        return originalFetch.call(windowObject, input, init)
      }
      const controller = new windowObject.AbortController()
      controllers.push(controller)
      return originalFetch.call(windowObject, input, { ...init, signal: controller.signal })
    }
  }
  return {
    stop() {
      if (originalSend) xhrPrototype.send = originalSend
      if (typeof originalFetch === 'function') windowObject.fetch = originalFetch
    },
    abort() {
      for (const request of requests) request.abort?.()
      for (const controller of controllers) controller.abort()
    },
  }
}

async function uploadTencentDataImage(windowObject, editor, source, index, timeoutMs) {
  if (
    !windowObject.DataTransfer
    || !windowObject.ClipboardEvent
    || !windowObject.File
  ) {
    throw new Error('腾讯云市场：浏览器缺少图片粘贴上传接口')
  }
  const blob = dataImageUrlToBlob(windowObject, source, '腾讯云市场')
  const extension = imageFileExtension(blob.type)
  const fileName = `draftferry-${index + 1}.${extension}`
  const file = new windowObject.File([blob], fileName, { type: blob.type })
  const transfer = new windowObject.DataTransfer()
  if (typeof transfer.items?.add !== 'function') {
    throw new Error('腾讯云市场：浏览器缺少图片剪贴板接口')
  }

  editor.innerHTML = '<p><br></p>'
  dispatchTencentInput(windowObject, editor, 'deleteContent')
  selectTencentEditor(windowObject, editor, true)
  transfer.items.add(file)
  const requestCapture = captureTencentUploadRequests(windowObject, fileName)
  try {
    editor.dispatchEvent(new windowObject.ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }))

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const uploaded = [...editor.querySelectorAll('img')].find((image) => (
        /^https?:/i.test(image.src)
      ))
      if (uploaded) return uploaded.src
      await new Promise((resolve) => windowObject.setTimeout(resolve, 100))
    }
    requestCapture.abort()
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
    throw new Error(`腾讯云市场：第 ${index + 1} 张内嵌图片上传超时`)
  } finally {
    requestCapture.stop()
  }
}

async function prepareTencentArticle(windowObject, editor, article, timeoutMs) {
  const container = parseHtml(windowObject.document, article.html)
  const sources = [...container.querySelectorAll('img')]
    .map((image) => image.getAttribute('src')?.trim() ?? '')
    .filter((source) => /^data:image\//i.test(source))
  const uploadedUrls = new Map()
  for (const source of sources) {
    if (!uploadedUrls.has(source)) {
      uploadedUrls.set(
        source,
        await uploadTencentDataImage(
          windowObject,
          editor,
          source,
          uploadedUrls.size,
          timeoutMs,
        ),
      )
    }
  }
  let html = article.html
  let portableMarkdown = article.portableMarkdown
  for (const [source, uploadedUrl] of uploadedUrls) {
    html = html.replaceAll(source, uploadedUrl)
    portableMarkdown = portableMarkdown.replaceAll(source, uploadedUrl)
  }
  return { ...article, html, portableMarkdown }
}

function replaceTencentDetail(windowObject, editor, article) {
  selectTencentEditor(windowObject, editor)

  let pasted = false
  if (windowObject.DataTransfer && windowObject.ClipboardEvent) {
    const transfer = new windowObject.DataTransfer()
    transfer.setData('text/html', article.html)
    transfer.setData('text/plain', article.portableMarkdown)
    const event = new windowObject.ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    })
    const before = editor.innerHTML
    editor.dispatchEvent(event)
    pasted = event.defaultPrevented || editor.innerHTML !== before
  }
  if (!pasted) {
    if (typeof windowObject.document.execCommand !== 'function') {
      throw new Error('腾讯云市场：浏览器缺少富文本粘贴接口')
    }
    const accepted = windowObject.document.execCommand('insertHTML', false, article.html)
    if (!accepted) throw new Error('腾讯云市场：商品详情编辑器拒绝 HTML')
  }
  dispatchTencentInput(windowObject, editor, 'insertFromPaste')
  editor.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
}

function guardTencentRollback(windowObject, editor, previousHtml, durationMs) {
  let restoring = false
  const restore = () => {
    if (restoring || editor.innerHTML === previousHtml) return
    restoring = true
    editor.innerHTML = previousHtml
    dispatchTencentInput(windowObject, editor, 'historyUndo')
    restoring = false
  }
  restore()
  const observer = new windowObject.MutationObserver(restore)
  observer.observe(editor, { childList: true, subtree: true, attributes: true })
  windowObject.setTimeout(() => observer.disconnect(), durationMs)
}

async function injectTencentMarket(document, article, options) {
  const editor = findTencentDetailEditor(document)
  const editorDocument = editor.ownerDocument
  const windowObject = editorDocument.defaultView ?? options.pageWindow ?? document.defaultView
  const previousHtml = editor.innerHTML
  confirmPotentialOverwrite(windowObject, hasMeaningfulEditorContent(editor))
  const uploadTimeoutMs = options.imageUploadTimeoutMs ?? 30_000
  const expectedImages = imageState(editorDocument, article.html).count
  try {
    const preparedArticle = await prepareTencentArticle(
      windowObject,
      editor,
      article,
      uploadTimeoutMs,
    )
    replaceTencentDetail(windowObject, editor, preparedArticle)
    await waitForCloudImages(
      windowObject,
      () => editor.innerHTML,
      expectedImages,
      '腾讯云市场',
      uploadTimeoutMs,
    )
  } catch (error) {
    guardTencentRollback(
      windowObject,
      editor,
      previousHtml,
      options.rollbackGuardMs
        ?? Math.min(Math.max(uploadTimeoutMs, 10_000), 30_000),
    )
    throw error
  }
  return {
    platformId: 'tencent-market',
    titleFilled: false,
    bodyFilled: true,
    mode: 'html-paste',
  }
}

const MARKDOWN_CONFIGS = {
  oschina: {
    id: 'oschina',
    name: '开源中国',
    titleSelectors: ['input[placeholder*="标题"]'],
    bodySelectors: ['textarea'],
    preflight(document) {
      const switchText = document.querySelector('.editor-switch-text')
      if (switchText?.textContent?.includes('切换到MD编辑器')) {
        throw new Error('开源中国：请先手动切换到 MD 编辑器，再点导入')
      }
    },
  },
}

export async function injectPlatformArticle(document, article, options = {}) {
  const runtimeDocument = options.pageWindow?.document ?? document
  const runtimeWindow = options.pageWindow ?? runtimeDocument.defaultView
  const fixturePlatform = (
    runtimeWindow.location.protocol === 'file:'
    && options.fixturePlatformId
  ) ? getPlatformById(options.fixturePlatformId) : null
  const platform = fixturePlatform ?? detectPlatform(runtimeWindow.location)
  if (!platform) {
    throw new Error('当前页面不是已支持的文章平台')
  }
  if (!article?.html || !article?.portableMarkdown) {
    throw new Error('转换结果不完整，无法导入平台')
  }

  if (MARKDOWN_CONFIGS[platform.id]) {
    return injectMarkdownTextEditor(
      runtimeDocument,
      article,
      MARKDOWN_CONFIGS[platform.id],
      runtimeWindow,
    )
  }
  if (platform.id === 'wechat') {
    return injectWechat(runtimeDocument, article, runtimeWindow)
  }
  if (platform.id === 'baijiahao') {
    return injectBaijiahao(runtimeDocument, article, runtimeWindow)
  }
  if (platform.id === 'zhihu') {
    return injectZhihu(runtimeDocument, article, options)
  }
  if (platform.id === 'toutiao') {
    return injectToutiao(runtimeDocument, article, runtimeWindow)
  }
  if (platform.id === 'sohu') {
    const result = await injectSohuArticle(runtimeDocument, article, options)
    return { platformId: 'sohu', ...result, mode: 'html-api' }
  }
  if (platform.id === 'aliyun-market') {
    return injectAliyunMarket(runtimeDocument, article, options)
  }
  if (platform.id === 'tencent-market') {
    return injectTencentMarket(runtimeDocument, article, options)
  }
  throw new Error(`${platform.name}：尚未实现导入适配器`)
}
