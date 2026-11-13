// 各平台共用的 DOM 小工具。页面窗口可能是油猴沙箱外的 unsafeWindow，所以事件和构造函数都从 win 取。

export function queryFirst(doc, selectors) {
  for (const selector of selectors) {
    const element = doc.querySelector(selector)
    if (element) return element
  }
  return null
}

export function isUsable(element) {
  if (!element || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false
  const view = element.ownerDocument.defaultView
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

export function readControl(control) {
  return ('value' in control ? control.value : control.textContent) ?? ''
}

// input / textarea 用原生 setter 写入，再发 input 和 change，框架才会感知。
export function setControlValue(win, control, value) {
  const proto = control instanceof win.HTMLTextAreaElement
    ? win.HTMLTextAreaElement.prototype
    : win.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(control, value)
  else control.value = value
  control.dispatchEvent(new win.Event('input', { bubbles: true }))
  control.dispatchEvent(new win.Event('change', { bubbles: true }))
  if (readControl(control) !== value) throw new Error('标题没有填进标题框，请手动粘贴标题')
}

// 富文本小输入框（contenteditable）：先走 insertText（和键盘输入同一条路径），不生效就直接写文本并发 input。
// 填完读回校验。
export function setContentEditableText(win, control, text) {
  const doc = win.document
  control.focus?.({ preventScroll: true })
  const range = doc.createRange()
  range.selectNodeContents(control)
  const selection = win.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  let inserted
  try {
    inserted = Boolean(doc.execCommand('insertText', false, text))
  } catch {
    inserted = false
  }
  if (!inserted || control.textContent.trim() !== text.trim()) {
    control.textContent = text
    control.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
  if (control.textContent.trim() !== text.trim()) throw new Error('标题没有填进标题框，请手动粘贴标题')
}

export function writeTitleControl(win, control, title) {
  if ('value' in control) setControlValue(win, control, title)
  else setContentEditableText(win, control, title)
}

export const squash = text => (text ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;|\s+/g, '')

export function textLength(html) {
  return squash(html).length
}

// 整篇替换后读回正文长度，文字少于期望的 80% 就报错（不回滚，报出原因交给使用者）。
export function assertReadBack(expectedHtml, actualHtml) {
  const expected = textLength(expectedHtml)
  const actual = textLength(actualHtml)
  if (actual < expected * 0.8) {
    throw new Error(`正文写入后读回长度不对（应有约 ${expected} 字，读到 ${actual} 字），已停下`)
  }
}

export function waitMs(win, ms) {
  return new Promise(resolve => win.setTimeout(resolve, ms))
}

// 页面文档加上其中的 shadow root 和同源 iframe 文档（上限 100 个），编辑器可能藏在里面。
export function collectOpenRoots(doc, limit = 100) {
  const roots = [doc]
  for (let index = 0; index < roots.length && roots.length < limit; index += 1) {
    for (const element of roots[index].querySelectorAll('*')) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot)
      if (element.tagName === 'IFRAME') {
        try {
          const frameDoc = element.contentDocument
          if (frameDoc && !roots.includes(frameDoc)) roots.push(frameDoc)
        } catch { /* 跨域 iframe 读不到，跳过 */ }
      }
      if (roots.length >= limit) break
    }
  }
  return roots
}
