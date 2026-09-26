import { parseHtml, readControlValue, writeControl } from './common.js'
import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from '../editor-content.js'

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

export function pickWechatBodyEditor(document) {
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
      windowObject.clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = windowObject.setTimeout(() => finish(new Error('微信公众号：内容接口调用超时')), 5000)
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
  })
}

export async function injectWechat(document, article, windowObject = document.defaultView, assertCurrent = () => {}) {
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
  assertCurrent()
  writeControl(windowObject, titleControl, article.title)

  return {
    platformId: 'wechat',
    titleFilled: Boolean(article.title),
    bodyFilled: true,
    mode: 'html-api',
  }
}

