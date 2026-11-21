import { queryFirst, setControlValue, isUsable } from '../dom.js'
import { hostMatches } from './shared.js'

const DIALOG_SELECTORS = [
  '[role="dialog"]', '[aria-modal="true"]', '.Modal-wrapper', '.Modal',
  '[class*="Modal"]', '[class*="modal"]', '[class*="Dialog"]', '[class*="dialog"]',
]

function dataUrlToBlob(win, source) {
  const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i)
  if (!match) throw new Error('知乎：内嵌图片不是有效的 Base64 图片')
  const binary = win.atob(match[2])
  const bytes = win.Uint8Array.from(binary, c => c.charCodeAt(0))
  return new win.Blob([bytes], { type: match[1].toLowerCase() })
}

async function uploadDataImage(win, source, index) {
  const blob = dataUrlToBlob(win, source)
  const subtype = blob.type.split('/')[1] ?? 'png'
  const form = new win.FormData()
  form.append('picture', blob, `draftferry-${index + 1}.${subtype === 'jpeg' ? 'jpg' : subtype}`)
  form.append('source', 'article')
  const response = await win.fetch('https://zhuanlan.zhihu.com/api/uploaded_images', {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-requested-with': 'fetch' },
    body: form,
  })
  if (!response.ok) throw new Error(`知乎：图片上传失败（HTTP ${response.status}）`)
  const result = await response.json()
  const src = typeof result?.src === 'string' ? result.src.trim() : ''
  const url = src ? new win.URL(src, win.location.href) : null
  if (!url || !/^https?:$/.test(url.protocol)) throw new Error('知乎：图片上传响应没有有效地址')
  return url.href
}

async function replaceDataImages(win, markdown, onProgress) {
  const sources = [...new Set(markdown.match(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi) ?? [])]
  let result = markdown
  for (const [index, source] of sources.entries()) {
    onProgress?.(`上传图片 ${index + 1}/${sources.length}…`)
    result = result.replaceAll(source, await uploadDataImage(win, source, index))
  }
  return result
}

function isActionable(button) {
  return !button.disabled && isUsable(button)
}

function waitForButton(win, predicate, timeoutMs, excluded, root) {
  const find = () => [...root.querySelectorAll('button')].find(button => (
    !excluded.has(button) && isActionable(button) && predicate(button.textContent?.trim() ?? '')
  ))
  const immediate = find()
  if (immediate) return Promise.resolve(immediate)
  return new Promise((resolve) => {
    const observer = new win.MutationObserver(() => {
      const button = find()
      if (button) finish(button)
    })
    const timer = win.setTimeout(() => finish(find() ?? null), timeoutMs)
    const finish = (button) => {
      observer.disconnect()
      win.clearTimeout(timer)
      resolve(button)
    }
    observer.observe(root, { childList: true, subtree: true })
  })
}

export default {
  id: 'zhihu',
  name: '知乎专栏',
  hosts: ['zhuanlan.zhihu.com'],
  format: 'markdown',
  match(url) {
    return hostMatches(url, this.hosts) && /^\/write\/?/.test(url.pathname)
  },
  findTitle(doc) {
    return queryFirst(doc, ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'])
  },
  findEditor(doc, win) {
    const editor = queryFirst(doc, ['.public-DraftEditor-content[contenteditable="true"]', '.DraftEditor-root [contenteditable="true"]'])
    if (!editor) throw new Error('知乎：未找到正文编辑器')
    return {
      getText: () => editor.textContent ?? '',
      async setHTML(_html, { markdown, onProgress } = {}) {
        const ready = await replaceDataImages(win, markdown, onProgress)
        onProgress?.('等待知乎解析…')
        const transfer = new win.DataTransfer()
        transfer.setData('text/plain', ready)
        const before = new Set([...doc.querySelectorAll('button')].filter(isActionable))
        editor.focus({ preventScroll: true })
        editor.dispatchEvent(new win.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
        const parseButton = await waitForButton(win, text => text.includes('确认并解析'), 5000, before, doc)
        if (!parseButton) throw new Error('知乎：没有出现“确认并解析”')
        const dialog = parseButton.closest(DIALOG_SELECTORS.join(', '))
        if (!dialog) throw new Error('知乎：无法确认 Markdown 解析弹窗边界')
        const beforeParse = new Set([...dialog.querySelectorAll('button')].filter(isActionable))
        parseButton.click()
        const confirmButton = await waitForButton(win, text => text === '确认', 5000, beforeParse, dialog)
        if (!confirmButton) throw new Error('知乎：没有出现解析后的“确认”')
        confirmButton.click()
      },
    }
  },
  writeTitle: (win, control, title) => setControlValue(win, control, title),
}
