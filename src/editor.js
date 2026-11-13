// 百家号图文编辑页的 DOM 事实，来自 legacy/src/adapters/baijiahao.js 与 0.7.1 诊断文件。
const TITLE_SELECTORS = [
  '.client_components_titleInput [contenteditable="true"]',
  '.client_pages_edit_components_titleInput [contenteditable="true"]',
  '[class*="titleInput"] [contenteditable="true"]',
]

export function findTitleControl(doc) {
  for (const selector of TITLE_SELECTORS) {
    const control = doc.querySelector(selector)
    if (control) return control
  }
  return null
}

// 百家号是单页应用：发完一篇再开新稿会新建 UEditor 实例，旧实例还留在 instants 里，
// 正文已经脱离页面。每次导入都重新取，取编号最大且仍挂在页面上的那一个。
export function findLiveEditor(pageWindow) {
  const instants = pageWindow?.UE_V2?.instants ?? {}
  const live = Object.entries(instants)
    .filter(([, editor]) => typeof editor?.getContent === 'function' && typeof editor?.setContent === 'function')
    .filter(([, editor]) => editor.body?.isConnected !== false && editor.iframe?.isConnected !== false)
    .sort(([a], [b]) => (Number(a.match(/\d+$/)?.[0] ?? -1) - Number(b.match(/\d+$/)?.[0] ?? -1)))
  return live.at(-1)?.[1] ?? null
}

const squash = text => text.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s+/g, '')

export function editorTextLength(html) {
  return squash(html ?? '').length
}

// 标题是富文本小输入框：先走 insertText（和键盘输入同一条路径），不生效就直接写文本并发 input 事件。
// 填完读回校验，仍不一致就抛错。
export function fillTitle(pageWindow, control, title) {
  const doc = pageWindow.document
  control.focus?.({ preventScroll: true })
  const range = doc.createRange()
  range.selectNodeContents(control)
  const selection = pageWindow.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  let inserted
  try {
    inserted = Boolean(doc.execCommand('insertText', false, title))
  } catch {
    inserted = false
  }
  if (!inserted || control.textContent.trim() !== title.trim()) {
    control.textContent = title
    control.dispatchEvent(new pageWindow.InputEvent('input', { bubbles: true, inputType: 'insertText', data: title }))
  }
  if (control.textContent.trim() !== title.trim()) {
    throw new Error('标题没有填进标题框，请手动粘贴标题')
  }
}

// 清空后整篇写入，再读回正文做长度校验（文字长度不足 80% 就报错）。
export function writeBody(editor, html) {
  editor.setContent('')
  editor.setContent(html)
  editor.fireEvent?.('contentChange')
  const expected = editorTextLength(html)
  const actual = editorTextLength(editor.getContent() ?? '')
  if (actual < expected * 0.8) {
    throw new Error(`正文写入后读回长度不对（应有约 ${expected} 字，读到 ${actual} 字），已停下`)
  }
}
