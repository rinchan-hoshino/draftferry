import { queryFirst, setControlValue, assertReadBack } from '../dom.js'
import { hostMatches } from './shared.js'

// DOM 事实与样式来自 legacy/src/adapters/wechat.js：标题是 #title，正文是 ProseMirror，
// 写入走公众号编辑器自己的 JSAPI。金色标题、浅灰引用等排版只在这里生效。
const ARTICLE_STYLES = {
  p: 'margin: 0 0 20px; font-size: 16px; line-height: 1.8; color: #2b2b2b;',
  blockquote: 'margin: 22px 0; padding: 14px 18px; border-left: 4px solid #d9d9d9; background: #f7f7f7; color: #555; line-height: 1.8;',
  'ul,ol': 'margin: 0 0 20px; padding-left: 1.8em; font-size: 16px; line-height: 1.8; color: #2b2b2b;',
  li: 'margin: 6px 0;',
  table: 'width: 100%; margin: 22px 0; border-collapse: collapse; table-layout: fixed; font-size: 14px; line-height: 1.65; color: #2b2b2b;',
  th: 'padding: 10px 12px; border: 1px solid #cfcfcf; background: #f2f2f2; font-weight: 700; text-align: left; word-break: break-word;',
  td: 'padding: 10px 12px; border: 1px solid #cfcfcf; text-align: left; word-break: break-word;',
  pre: 'margin: 22px 0; padding: 16px; border: 1px solid #dedede; border-radius: 5px; background: #f5f5f5; line-height: 1.65; white-space: pre-wrap; word-break: break-word;',
  code: 'padding: 2px 4px; border-radius: 3px; background: #f2f2f2; color: #c7254e; font-family: Consolas, Monaco, monospace; font-size: 0.9em;',
  'pre code': 'padding: 0; background: transparent; color: #333; font-family: Consolas, Monaco, monospace; font-size: 14px;',
  img: 'display: block; max-width: 100%; height: auto; margin: 22px auto;',
  hr: 'margin: 30px 0; border: 0; border-top: 1px solid #dedede;',
  a: 'color: #1677b3; text-decoration: underline; word-break: break-word;',
  strong: 'font-weight: 700;',
  'blockquote p': 'margin: 0 0 12px; font-size: 16px; line-height: 1.8; color: #555;',
  'li p': 'margin: 8px 0; font-size: 16px; line-height: 1.8; color: #2b2b2b;',
}

const EMPTY_INLINE_TAGS = new Set(['BR', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'DEL', 'CODE', 'MARK', 'SUB', 'SUP', 'A'])

// 表格、图片、列表、引用后面要留一个可以输入的段落，已有的空段落就复用。
function ensureTrailingParagraph(container) {
  const doc = container.ownerDocument
  const last = [...container.childNodes].reverse().find(node => (
    node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim())
  ))
  const canReuse = last?.nodeType === 1 && last.tagName === 'P'
    && !last.textContent.trim()
    && [...last.querySelectorAll('*')].every(node => EMPTY_INLINE_TAGS.has(node.tagName))
  const paragraph = canReuse ? last : doc.createElement('p')
  if (!paragraph.querySelector('br')) paragraph.append(doc.createElement('br'))
  if (!canReuse) container.append(paragraph)
}

export function prepareWechatHtml(doc, html) {
  const container = doc.createElement('div')
  container.innerHTML = html
  // 公众号会重置标题样式，所以层级同时写进内联格式里。
  const headingSizes = [24, 22, 19, 17, 16, 16]
  for (const heading of container.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    heading.style.cssText = 'font-weight: 700; line-height: 1.5; color: #202020;'
    const level = Number(heading.tagName[1])
    const size = `${headingSizes[level - 1]}px`
    heading.style.fontSize = size
    heading.style.margin = `${level <= 2 ? 32 : level === 3 ? 26 : 22}px 0 ${level <= 2 ? 16 : 12}px`
    if (level <= 2) {
      heading.style.borderLeft = '4px solid #d8a522'
      heading.style.paddingLeft = '10px'
    }
    const span = doc.createElement('span')
    span.style.fontSize = size
    const strong = doc.createElement('strong')
    strong.style.fontWeight = '700'
    strong.append(...heading.childNodes)
    span.append(strong)
    heading.append(span)
  }
  for (const item of container.querySelectorAll('li')) {
    if (!item.textContent.trim() && !item.querySelector('img,table,pre')) item.remove()
  }
  for (const list of container.querySelectorAll('ol, ul')) {
    for (const node of [...list.childNodes]) {
      if (node.nodeType === 3 && !node.textContent.trim()) node.remove()
    }
    if (!list.querySelector('li')) list.remove()
  }
  ensureTrailingParagraph(container)
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

export function pickWechatBodyEditor(doc) {
  const titleEditor = doc.querySelector('.title-editor__input .ProseMirror')
  const candidates = [...doc.querySelectorAll('.ProseMirror')]
    .filter(editor => editor !== titleEditor && !editor.closest('.title-editor__input'))
  return candidates.find(editor => editor.textContent?.includes('从这里开始写正文')) ?? candidates[0] ?? null
}

function invokeContentApi(win, html) {
  const invoke = win.__MP_Editor_JSAPI__?.invoke
  if (typeof invoke !== 'function') throw new Error('微信公众号：未找到 mp_editor_set_content 接口，待真实页面确认')
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      win.clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = win.setTimeout(() => finish(new Error('微信公众号：内容接口调用超时')), 5000)
    try {
      invoke({
        apiName: 'mp_editor_set_content',
        apiParam: { content: html },
        sucCb: () => finish(),
        errCb: error => finish(new Error(`微信公众号：内容接口失败：${error?.message ?? String(error)}`)),
      })
    } catch (error) {
      finish(error)
    }
  })
}

export default {
  id: 'wechat',
  name: '微信公众号',
  hosts: ['mp.weixin.qq.com'],
  match(url) {
    return hostMatches(url, this.hosts)
      && /^\/cgi-bin\/appmsg\/?$/.test(url.pathname)
      && url.searchParams.get('t') === 'media/appmsg_edit_v2'
  },
  findTitle(doc) {
    return queryFirst(doc, ['#title'])
  },
  findEditor(doc, win) {
    const editor = pickWechatBodyEditor(doc)
    if (!editor) throw new Error('微信公众号：未找到正文编辑器')
    return {
      getText: () => editor.textContent ?? '',
      async setHTML(html) {
        const prepared = prepareWechatHtml(doc, html)
        await invokeContentApi(win, prepared)
        assertReadBack(html, editor.textContent ?? '')
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
}
