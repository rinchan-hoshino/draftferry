import { parseHtml, readControlValue, writeControl } from './common.js'
import { confirmPotentialOverwrite, hasMeaningfulEditorContent } from '../editor-content.js'

// Article presentation belongs to this adapter: portable drafts and the other
// platforms keep semantic HTML and their own typography.
const ARTICLE_STYLES = {
  p: 'margin: 0 0 20px; font-size: 16px; line-height: 1.8; color: #353b39;',
  blockquote: 'margin: 22px 0; padding: 14px 18px; border-left: 3px solid #bfd4d0; background: #f2f7f5; color: #556760; line-height: 1.8;',
  'ul,ol': 'margin: 0 0 20px; padding-left: 1.8em; font-size: 16px; line-height: 1.8; color: #353b39;',
  li: 'margin: 6px 0;',
  table: 'width: 100%; margin: 22px 0; border-collapse: collapse; table-layout: fixed; font-size: 14px; line-height: 1.65; color: #353b39;',
  th: 'padding: 10px 12px; border: 1px solid #dce6e2; background: #eef4f1; font-weight: 700; text-align: left; word-break: break-word;',
  td: 'padding: 10px 12px; border: 1px solid #dce6e2; text-align: left; word-break: break-word;',
  pre: 'margin: 22px 0; padding: 16px; border: 1px solid #e1e8e4; border-radius: 5px; background: #f5f7f5; line-height: 1.65; white-space: pre-wrap; word-break: break-word;',
  code: 'padding: 2px 4px; border-radius: 3px; background: #eef4f1; color: #2f6f6b; font-family: Consolas, Monaco, monospace; font-size: 0.9em;',
  'pre code': 'padding: 0; background: transparent; color: #3f514a; font-family: Consolas, Monaco, monospace; font-size: 14px;',
  img: 'display: block; max-width: 100%; height: auto; margin: 22px auto;',
  hr: 'margin: 30px 0; border: 0; border-top: 1px solid #dce6e2;',
  a: 'color: #2f6f6b; text-decoration: underline; word-break: break-word;',
  strong: 'font-weight: 700;',
  'blockquote p': 'margin: 0 0 12px; font-size: 16px; line-height: 1.8; color: #556760;',
  'li p': 'margin: 8px 0; font-size: 16px; line-height: 1.8; color: #353b39;',
}

function prepareWechatHtml(document, html) {
  const container = parseHtml(document, html)
  // WeChat resets heading styles and may normalize the block tag. Carry the
  // hierarchy in inline formatting as well as the article's block styles.
  const headingSizes = [24, 22, 19, 17, 16, 16]
  for (const heading of container.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    heading.style.cssText = 'font-weight: 700; line-height: 1.5; color: #24302d;'
    const level = Number(heading.tagName[1])
    const size = `${headingSizes[level - 1]}px`
    heading.style.fontSize = size
    heading.style.margin = `${level <= 2 ? 32 : level === 3 ? 26 : 22}px 0 ${level <= 2 ? 16 : 12}px`
    if (level <= 2) {
      heading.style.borderLeft = '3px solid #2f6f6b'
      heading.style.paddingLeft = '12px'
    }
    const span = document.createElement('span')
    span.style.fontSize = size
    const strong = document.createElement('strong')
    strong.style.fontWeight = '700'
    strong.append(...heading.childNodes)
    span.append(strong)
    heading.append(span)
  }
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
  // Clean empty structural nodes before decorating them; styling alone must not
  // turn an empty list item into meaningful article content.
  for (const [selector, cssText] of Object.entries(ARTICLE_STYLES)) {
    for (const element of container.querySelectorAll(selector)) element.style.cssText = cssText
  }
  for (const element of container.querySelectorAll('blockquote > :last-child, li > :last-child')) {
    element.style.marginBottom = '0'
  }
  for (const list of container.querySelectorAll('li > ul, li > ol')) list.style.margin = '8px 0 0'
  if (container.firstElementChild) container.firstElementChild.style.marginTop = '0'
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
