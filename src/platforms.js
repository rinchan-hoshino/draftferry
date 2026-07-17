import {
  hasMeaningfulEditorContent,
  injectSohuArticle,
  semanticSignature,
} from './core.js'

const PLATFORMS = [
  { id: 'cnblogs', name: '博客园', hosts: ['cnblogs.com'] },
  { id: 'csdn', name: 'CSDN', hosts: ['csdn.net'] },
  { id: 'zhihu', name: '知乎', hosts: ['zhihu.com'] },
  { id: 'wechat', name: '微信公众号', hosts: ['mp.weixin.qq.com'] },
  { id: 'oschina', name: '开源中国', hosts: ['oschina.net'] },
  { id: 'baijiahao', name: '百家号', hosts: ['baijiahao.baidu.com'] },
  { id: 'toutiao', name: '今日头条', hosts: ['toutiao.com'] },
  { id: 'sohu', name: '搜狐号', hosts: ['mp.sohu.com'] },
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

function assertBlankTextEditor(titleControl, bodyEditor) {
  if (readControlValue(titleControl).trim() || readBodyValue(bodyEditor).trim()) {
    throw new Error('当前标题或正文已有内容；请新建空白文章后再导入')
  }
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
  assertBlankTextEditor(titleControl, bodyEditor)

  const previousTitle = readControlValue(titleControl)
  const previousBody = readBodyValue(bodyEditor)
  try {
    writeBodyValue(windowObject, bodyEditor, article.portableMarkdown)
    writeControl(windowObject, titleControl, article.title)
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
    if (
      readControlValue(titleControl) !== article.title
      || readBodyValue(bodyEditor) !== article.portableMarkdown
    ) {
      throw new Error(`${config.name}：编辑器在写入后改变了 Markdown`)
    }
  } catch (error) {
    try {
      writeControl(windowObject, titleControl, previousTitle)
      writeBodyValue(windowObject, bodyEditor, previousBody)
      await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
      if (
        readControlValue(titleControl) !== previousTitle
        || readBodyValue(bodyEditor) !== previousBody
      ) {
        throw new Error('标题或 Markdown 正文未恢复', { cause: error })
      }
    } catch (rollbackError) {
      throw new Error(
        `${config.name}：写入失败且回滚未通过验证，请刷新页面且不要保存；原错误：${error instanceof Error ? error.message : String(error)}`,
        { cause: rollbackError },
      )
    }
    throw error
  }

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

function semanticHtmlMatches(document, actualHtml, expectedHtml) {
  const actual = parseHtml(document, actualHtml)
  const expected = parseHtml(document, expectedHtml)
  return semanticSignature(actual) === semanticSignature(expected)
}

function assertSemanticHtml(document, actualHtml, expectedHtml, name) {
  if (!semanticHtmlMatches(document, actualHtml, expectedHtml)) {
    throw new Error(`${name}编辑器改变了文章结构`)
  }
}

async function undoUntilRestored(document, editor, previousHtml, name, maxAttempts = 5) {
  const windowObject = document.defaultView
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (semanticHtmlMatches(document, editor.innerHTML, previousHtml)) return
    if (!document.execCommand('undo', false)) break
    editor.dispatchEvent(new windowObject.InputEvent('input', {
      bubbles: true,
      inputType: 'historyUndo',
    }))
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
  }
  if (!semanticHtmlMatches(document, editor.innerHTML, previousHtml)) {
    throw new Error(`${name}正文 undo 未恢复`)
  }
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
  if (
    readControlValue(titleControl).trim()
    || hasMeaningfulEditorContent(bodyEditor)
  ) {
    throw new Error('当前标题或正文已有内容；请新建空白文章后再导入')
  }
  if (typeof windowObject.__MP_Editor_JSAPI__?.invoke !== 'function') {
    throw new Error('微信公众号：未找到 mp_editor_set_content 接口，待真实页面确认')
  }

  const previousTitle = readControlValue(titleControl)
  const previousHtml = bodyEditor.innerHTML
  try {
    await invokeWechatEditor(windowObject, article.html)
    assertSemanticHtml(document, bodyEditor.innerHTML, article.html, '微信公众号')
    writeControl(windowObject, titleControl, article.title)
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
    if (readControlValue(titleControl) !== article.title) {
      throw new Error('微信公众号：标题在写入后被改变')
    }
    assertSemanticHtml(document, bodyEditor.innerHTML, article.html, '微信公众号')
  } catch (error) {
    try {
      writeControl(windowObject, titleControl, previousTitle)
      await invokeWechatEditor(windowObject, previousHtml)
      await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
      if (readControlValue(titleControl) !== previousTitle) {
        throw new Error('标题未恢复', { cause: error })
      }
      assertSemanticHtml(document, bodyEditor.innerHTML, previousHtml, '微信公众号回滚后的')
    } catch (rollbackError) {
      throw new Error(
        `微信公众号：写入失败且回滚未通过验证，请刷新页面且不要保存；原错误：${error instanceof Error ? error.message : String(error)}`,
        { cause: rollbackError },
      )
    }
    throw error
  }

  return {
    platformId: 'wechat',
    titleFilled: Boolean(article.title),
    bodyFilled: true,
    mode: 'html-api',
  }
}

function normalizedVisibleText(element) {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function assertRichFidelity(document, actualElement, expectedHtml, name) {
  const expected = parseHtml(document, expectedHtml)
  const fields = [
    ['正文文本', normalizedVisibleText(actualElement), normalizedVisibleText(expected)],
    ['图片', actualElement.querySelectorAll('img').length, expected.querySelectorAll('img').length],
    ['表格', actualElement.querySelectorAll('table').length, expected.querySelectorAll('table').length],
    ['代码块', actualElement.querySelectorAll('pre').length, expected.querySelectorAll('pre').length],
  ]
  const changed = fields
    .filter(([, actual, wanted]) => actual !== wanted)
    .map(([label]) => label)
  if (changed.length) {
    throw new Error(`${name}编辑器改变了这些内容：${changed.join('、')}`)
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

  const previousTitle = readControlValue(titleControl)
  const previousHtml = editor.getContent() ?? ''
  if (previousTitle.trim() || hasMeaningfulEditorContent(parseHtml(document, previousHtml))) {
    throw new Error('当前标题或正文已有内容；请新建空白文章后再导入')
  }

  try {
    editor.setContent(article.html)
    editor.fireEvent?.('contentChange')
    assertSemanticHtml(document, editor.getContent(), article.html, '百家号')
    writeControl(windowObject, titleControl, article.title)
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
    if (readControlValue(titleControl) !== article.title) {
      throw new Error('百家号：标题在写入后被改变')
    }
    assertSemanticHtml(document, editor.getContent(), article.html, '百家号')
  } catch (error) {
    try {
      writeControl(windowObject, titleControl, previousTitle)
      editor.setContent(previousHtml)
      editor.fireEvent?.('contentChange')
      await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
      if (readControlValue(titleControl) !== previousTitle) {
        throw new Error('标题未恢复', { cause: error })
      }
      assertSemanticHtml(document, editor.getContent(), previousHtml, '百家号回滚后的')
    } catch (rollbackError) {
      throw new Error(
        `百家号：写入失败且回滚未通过验证，请刷新页面且不要保存；原错误：${error instanceof Error ? error.message : String(error)}`,
        { cause: rollbackError },
      )
    }
    throw error
  }
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
  if (readControlValue(titleControl).trim() || hasMeaningfulEditorContent(editor)) {
    throw new Error('当前标题或正文已有内容；请新建空白文章后再导入')
  }
  if (typeof document.execCommand !== 'function') {
    throw new Error('今日头条：浏览器不支持 insertHTML 编辑命令')
  }
  const previousTitle = readControlValue(titleControl)
  const previousHtml = editor.innerHTML
  let bodyMutated = false
  try {
    editor.focus()
    selectEditorEnd(windowObject, editor)
    const accepted = Boolean(document.execCommand('insertHTML', false, article.html))
    bodyMutated = !semanticHtmlMatches(document, editor.innerHTML, previousHtml)
    if (!accepted || !bodyMutated) throw new Error('今日头条：编辑器拒绝 insertHTML')
    editor.dispatchEvent(new windowObject.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }))
    editor.dispatchEvent(new windowObject.Event('change', { bubbles: true }))
    assertSemanticHtml(document, editor.innerHTML, article.html, '今日头条')
    writeControl(windowObject, titleControl, article.title)
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
    if (readControlValue(titleControl) !== article.title) throw new Error('今日头条：标题在写入后被改变')
    assertSemanticHtml(document, editor.innerHTML, article.html, '今日头条')
  } catch (error) {
    try {
      writeControl(windowObject, titleControl, previousTitle)
      if (bodyMutated || !semanticHtmlMatches(document, editor.innerHTML, previousHtml)) {
        await undoUntilRestored(document, editor, previousHtml, '今日头条')
      }
      if (readControlValue(titleControl) !== previousTitle) throw new Error('标题未恢复', { cause: error })
      assertSemanticHtml(document, editor.innerHTML, previousHtml, '今日头条回滚后的')
    } catch (rollbackError) {
      throw new Error(
        `今日头条：写入失败且回滚未通过验证，请刷新页面且不要保存；原错误：${error instanceof Error ? error.message : String(error)}`,
        { cause: rollbackError },
      )
    }
    throw error
  }
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

async function waitForButton(windowObject, predicate, timeoutMs, excluded = new Set()) {
  const find = () => [...windowObject.document.querySelectorAll('button')].find((button) => (
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
    observer.observe(windowObject.document.body, { childList: true, subtree: true })
    const timer = windowObject.setTimeout(() => {
      observer.disconnect()
      resolve(find() ?? null)
    }, timeoutMs)
  })
}

async function injectZhihu(document, article, options) {
  const windowObject = document.defaultView
  const titleControl = queryFirst(document, ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'])
  const editor = queryFirst(document, ['.public-DraftEditor-content[contenteditable="true"]', '.DraftEditor-root [contenteditable="true"]'])
  if (!titleControl || !editor) throw new Error('知乎：未找到标题或正文编辑器')
  if (readControlValue(titleControl).trim() || hasMeaningfulEditorContent(editor)) {
    throw new Error('当前标题或正文已有内容；请新建空白文章后再导入')
  }
  if (!windowObject.DataTransfer || !windowObject.ClipboardEvent || typeof document.execCommand !== 'function') {
    throw new Error('知乎：浏览器缺少 Markdown 粘贴或 undo 接口')
  }
  const previousTitle = readControlValue(titleControl)
  const previousHtml = editor.innerHTML
  let bodyMutated = false
  try {
    const transfer = new windowObject.DataTransfer()
    transfer.setData('text/plain', article.portableMarkdown)
    const buttonsBeforePaste = new Set(
      [...document.querySelectorAll('button')].filter(isActionableButton),
    )
    editor.focus()
    editor.dispatchEvent(new windowObject.ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }))
    bodyMutated = hasMeaningfulEditorContent(editor)
    if (!bodyMutated) throw new Error('知乎：编辑器没有接受 Markdown 粘贴')
    const timeoutMs = options.waitTimeoutMs ?? 5000
    const parseButton = await waitForButton(
      windowObject,
      (text) => text.includes('确认并解析'),
      timeoutMs,
      buttonsBeforePaste,
    )
    if (!parseButton) throw new Error('知乎：没有出现“确认并解析”')
    const buttonsBeforeParse = new Set(
      [...document.querySelectorAll('button')].filter(isActionableButton),
    )
    parseButton.click()
    const confirmButton = await waitForButton(
      windowObject,
      (text) => text === '确认',
      timeoutMs,
      buttonsBeforeParse,
    )
    if (!confirmButton) throw new Error('知乎：没有出现解析后的“确认”')
    confirmButton.click()
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
    assertRichFidelity(document, editor, article.html, '知乎')
    writeControl(windowObject, titleControl, article.title)
    await new Promise((resolve) => windowObject.setTimeout(resolve, 0))
    if (readControlValue(titleControl) !== article.title) throw new Error('知乎：标题在写入后被改变')
    assertRichFidelity(document, editor, article.html, '知乎')
  } catch (error) {
    try {
      writeControl(windowObject, titleControl, previousTitle)
      if (bodyMutated || !semanticHtmlMatches(document, editor.innerHTML, previousHtml)) {
        await undoUntilRestored(document, editor, previousHtml, '知乎')
      }
      if (readControlValue(titleControl) !== previousTitle) throw new Error('标题未恢复', { cause: error })
      assertSemanticHtml(document, editor.innerHTML, previousHtml, '知乎回滚后的')
    } catch (rollbackError) {
      throw new Error(
        `知乎：写入失败且回滚未通过验证，请刷新页面且不要保存；原错误：${error instanceof Error ? error.message : String(error)}`,
        { cause: rollbackError },
      )
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
