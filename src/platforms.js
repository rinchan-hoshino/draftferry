import {
  confirmPotentialOverwrite,
  hasMeaningfulEditorContent,
  injectSohuArticle,
} from './core.js'

const PLATFORMS = [
  { id: 'cnblogs', name: '博客园', hosts: ['cnblogs.com'] },
  { id: 'csdn', name: 'CSDN', hosts: ['csdn.net'] },
  { id: 'zhihu', name: '知乎', hosts: ['zhihu.com'] },
  { id: 'wechat', name: '微信公众号', hosts: ['mp.weixin.qq.com'] },
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
]

export const PLATFORM_IDS = PLATFORMS.map((platform) => platform.id)

export function getPlatformById(id) {
  return PLATFORMS.find((platform) => platform.id === id) ?? null
}

function hostnameMatches(hostname, expected) {
  return hostname === expected || hostname.endsWith(`.${expected}`)
}

export function detectPlatform(url) {
  return PLATFORMS.find((platform) => (
    platform.hosts.some((host) => hostnameMatches(url.hostname, host))
    && (!platform.editorPath || platform.editorPath.test(url.pathname))
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

async function injectMarkdownTextEditor(document, article, config) {
  const windowObject = document.defaultView
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

async function injectWechat(document, article) {
  const windowObject = document.defaultView
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

  await invokeWechatEditor(windowObject, article.html)
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

async function injectBaijiahao(document, article) {
  const windowObject = document.defaultView
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

async function injectToutiao(document, article) {
  const windowObject = document.defaultView
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
  const accepted = Boolean(document.execCommand('insertHTML', false, article.html))
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

function dataImageUrlToBlob(windowObject, source) {
  const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i)
  if (!match) {
    throw new Error('知乎：内嵌图片不是有效的 Base64 图片')
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

async function prepareZhihuMarkdown(document, article) {
  const windowObject = document.defaultView
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
  const windowObject = document.defaultView
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
    const markdown = await prepareZhihuMarkdown(document, article)
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

const MARKDOWN_CONFIGS = {
  cnblogs: {
    id: 'cnblogs',
    name: '博客园',
    titleSelectors: ['#post-title', 'input[placeholder*="标题"]'],
    bodySelectors: ['#md-editor', 'textarea.not-resizable'],
  },
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    titleSelectors: ['.article-bar__title input', 'input[placeholder*="标题"]'],
    bodySelectors: ['.editor__inner[contenteditable="true"]', '[contenteditable="true"].markdown-highlighting'],
  },
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
  const fixturePlatform = (
    document.defaultView.location.protocol === 'file:'
    && options.fixturePlatformId
  ) ? getPlatformById(options.fixturePlatformId) : null
  const platform = fixturePlatform ?? detectPlatform(document.defaultView.location)
  if (!platform) {
    throw new Error('当前页面不是已支持的文章平台')
  }
  if (!article?.html || !article?.portableMarkdown) {
    throw new Error('转换结果不完整，无法导入平台')
  }

  if (MARKDOWN_CONFIGS[platform.id]) {
    return injectMarkdownTextEditor(document, article, MARKDOWN_CONFIGS[platform.id])
  }
  if (platform.id === 'wechat') {
    return injectWechat(document, article)
  }
  if (platform.id === 'baijiahao') {
    return injectBaijiahao(document, article)
  }
  if (platform.id === 'zhihu') {
    return injectZhihu(document, article, options)
  }
  if (platform.id === 'toutiao') {
    return injectToutiao(document, article)
  }
  if (platform.id === 'sohu') {
    const result = await injectSohuArticle(document, article)
    return { platformId: 'sohu', ...result, mode: 'html-api' }
  }
  throw new Error(`${platform.name}：尚未实现导入适配器`)
}
