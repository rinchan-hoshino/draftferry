import { compile } from 'stylis'
import { assertReadBack, queryFirst, setControlValue } from '../dom.ts'
import wechatCss from '../themes/wechat.css?raw'
import type { PlatformAdapter } from '../types.ts'
import { hostMatches } from './shared.ts'

const EMPTY_INLINE_TAGS = new Set([
  'BR',
  'SPAN',
  'STRONG',
  'EM',
  'B',
  'I',
  'U',
  'S',
  'DEL',
  'CODE',
  'MARK',
  'SUB',
  'SUP',
  'A',
])

function ensureTrailingParagraph(container: HTMLElement): void {
  const doc = container.ownerDocument
  const last = [...container.childNodes]
    .reverse()
    .find((node) => node.nodeType === 1 || (node.nodeType === 3 && (node.textContent ?? '').trim()))
  const lastEl = last?.nodeType === 1 ? (last as HTMLElement) : null
  const canReuse =
    lastEl !== null &&
    lastEl.tagName === 'P' &&
    !(lastEl.textContent ?? '').trim() &&
    [...lastEl.querySelectorAll('*')].every((node) => EMPTY_INLINE_TAGS.has(node.tagName))
  const paragraph = canReuse ? lastEl : doc.createElement('p')
  if (!paragraph.querySelector('br')) paragraph.append(doc.createElement('br'))
  if (!canReuse) container.append(paragraph)
}

type Specificity = [number, number, number, number]

function computeSpecificity(selector: string, order: number): Specificity {
  const cleaned = selector.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, (m) =>
    m.startsWith('::') ? ' __el__ ' : ' .__cls__ ',
  )
  const idCount = (cleaned.match(/#[a-zA-Z_-][\w-]*/g) ?? []).length
  const classAttrPseudoCount =
    (cleaned.match(/\.[a-zA-Z_-][\w-]*/g) ?? []).length +
    (cleaned.match(/\[[^\]]+\]/g) ?? []).length
  const elementCount = (
    cleaned
      .replace(/#[a-zA-Z_-][\w-]*/g, ' ')
      .replace(/\.[a-zA-Z_-][\w-]*/g, ' ')
      .replace(/\[[^\]]+\]/g, ' ')
      .match(/\b[a-zA-Z][\w-]*\b/g) ?? []
  ).length
  return [idCount, classAttrPseudoCount, elementCount, order]
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function applyCssToContainer(container: HTMLElement, css: string): void {
  const rules: Array<{
    selector: string
    specificity: Specificity
    declarations: Array<[string, string]>
  }> = []
  let order = 0
  for (const node of compile(css)) {
    if (node.type !== 'rule' || !Array.isArray(node.props) || !Array.isArray(node.children)) {
      continue
    }
    const declarations: Array<[string, string]> = []
    for (const child of node.children) {
      if (child.type === 'decl' && typeof child.props === 'string' && typeof child.children === 'string') {
        declarations.push([child.props, child.children])
      }
    }
    if (declarations.length === 0) continue
    for (const selector of node.props) {
      const trimmed = selector.trim()
      if (!trimmed) continue
      rules.push({
        selector: trimmed,
        specificity: computeSpecificity(trimmed, order++),
        declarations,
      })
    }
  }

  rules.sort((a, b) => compareSpecificity(a.specificity, b.specificity))

  for (const rule of rules) {
    let matched: NodeListOf<HTMLElement>
    try {
      matched = container.querySelectorAll<HTMLElement>(rule.selector)
    } catch {
      continue
    }
    for (const el of matched) {
      for (const [prop, val] of rule.declarations) {
        el.style.setProperty(prop, val)
      }
    }
  }
}

export function prepareWechatHtml(doc: Document, html: string): string {
  const container = doc.createElement('div')
  container.innerHTML = html

  const headingSizes = [20, 18, 16, 15, 15, 15]
  for (const heading of container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) {
    const level = Number(heading.tagName[1])
    const size = `${headingSizes[level - 1]}px`
    const span = doc.createElement('span')
    span.style.fontSize = size
    const strong = doc.createElement('strong')
    strong.style.fontWeight = '700'
    strong.append(...heading.childNodes)
    span.append(strong)
    heading.append(span)
  }

  for (const item of container.querySelectorAll('li')) {
    if (!(item.textContent ?? '').trim() && !item.querySelector('img,table,pre')) item.remove()
  }
  for (const list of container.querySelectorAll('ol, ul')) {
    for (const node of [...list.childNodes]) {
      if (node.nodeType === 3 && !(node.textContent ?? '').trim()) node.remove()
    }
    if (!list.querySelector('li')) list.remove()
  }

  for (const table of container.querySelectorAll('table')) {
    if (table.parentElement?.tagName === 'SECTION') continue
    const wrapper = doc.createElement('section')
    wrapper.setAttribute(
      'style',
      'width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 22px 0;',
    )
    table.replaceWith(wrapper)
    wrapper.append(table)
  }

  ensureTrailingParagraph(container)
  applyCssToContainer(container, wechatCss)
  const firstEl = container.firstElementChild as HTMLElement | null
  if (firstEl?.style) {
    firstEl.style.marginTop = '0'
  }

  return container.innerHTML
}

export function pickWechatBodyEditor(doc: Document): HTMLElement | null {
  const titleEditor = doc.querySelector('.title-editor__input .ProseMirror')
  const candidates = [...doc.querySelectorAll<HTMLElement>('.ProseMirror')].filter(
    (editor) => editor !== titleEditor && !editor.closest('.title-editor__input'),
  )
  return (
    candidates.find((editor) => editor.textContent?.includes('从这里开始写正文')) ??
    candidates[0] ??
    null
  )
}

interface MpEditorApi {
  invoke?: (options: {
    apiName: string
    apiParam: { content: string }
    sucCb: () => void
    errCb: (err: unknown) => void
  }) => void
}

function invokeContentApi(win: Window, html: string): Promise<void> {
  const invoke = (win as unknown as { __MP_Editor_JSAPI__?: MpEditorApi }).__MP_Editor_JSAPI__
    ?.invoke
  if (typeof invoke !== 'function') {
    throw new Error('微信公众号：未找到 mp_editor_set_content 接口')
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      win.clearTimeout(timer)
      if (error) reject(error instanceof Error ? error : new Error(String(error)))
      else resolve()
    }
    const timer = win.setTimeout(
      () => finish(new Error('微信公众号：内容接口调用超时')),
      5000,
    )
    try {
      invoke({
        apiName: 'mp_editor_set_content',
        apiParam: { content: html },
        sucCb: () => finish(),
        errCb: (error: unknown) => {
          const msg =
            error && typeof error === 'object' && 'message' in error
              ? String((error as { message: unknown }).message)
              : String(error)
          finish(new Error(`微信公众号：内容接口失败：${msg}`))
        },
      })
    } catch (error) {
      finish(error)
    }
  })
}

const wechat: PlatformAdapter = {
  id: 'wechat',
  name: '微信公众号',
  hosts: ['mp.weixin.qq.com'],
  match(url) {
    return (
      hostMatches(url, this.hosts) &&
      /^\/cgi-bin\/appmsg\/?$/.test(url.pathname) &&
      url.searchParams.get('t') === 'media/appmsg_edit_v2'
    )
  },
  findTitle(doc) {
    return queryFirst(doc, ['#title'])
  },
  findEditor(doc, win) {
    const editor = pickWechatBodyEditor(doc)
    if (!editor) throw new Error('微信公众号：未找到正文编辑器')
    return {
      getText: () => editor.textContent ?? '',
      async setHTML(html, { onProgress } = {}) {
        onProgress?.('写入正文…')
        const prepared = prepareWechatHtml(doc, html)
        await invokeContentApi(win, prepared)
        assertReadBack(html, editor.textContent ?? '')
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
}

export default wechat
