import { squash, waitMs } from '../dom.js'
import { hostMatches } from './shared.js'

// 阿里云市场：只写“产品详情”这一个 CKEditor 字段，图片由平台上传。DOM 事实来自 legacy/src/adapters/aliyun-market.js。
const LABELS = ['产品详情', '商品详情']
const UPLOAD_TIMEOUT_MS = 30_000

function normalizedLabel(element) {
  return element.textContent?.replace(/\s+/g, '').replace(/^[*＊]+|[：:*＊]+$/g, '') ?? ''
}

export function findAliyunDetailEditor(doc, win) {
  const label = [...doc.querySelectorAll('label')].find(element => LABELS.includes(normalizedLabel(element)))
  const formItem = label?.closest('.acpn-form-item, .next-form-item')
  const wrapper = formItem?.querySelector('.cke[class*="cke_editor_"]')
  const instanceClass = wrapper ? [...wrapper.classList].find(name => /^cke_editor_.+/.test(name)) : null
  const editor = instanceClass ? win.CKEDITOR?.instances?.[instanceClass.replace(/^cke_editor_/, '')] : null
  if (!label || !formItem || !wrapper || !editor) throw new Error('阿里云市场：未找到“产品详情”CKEditor 实例')
  for (const name of ['getData', 'setData', 'fire', 'editable', 'createRange', 'getSelection']) {
    if (typeof editor[name] !== 'function') throw new Error('阿里云市场：产品详情 CKEditor 接口不完整')
  }
  if (!editor.editable() || editor.readOnly || (editor.mode && editor.mode !== 'wysiwyg')) {
    throw new Error('阿里云市场：请等待产品详情加载完成，并切换到可编辑的富文本模式')
  }
  return editor
}

function imageSources(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html')
  return [...doc.querySelectorAll('img')].map(img => img.getAttribute('src')?.trim() ?? '')
}

// 等 CKEditor 的上传回调数量够了；任何一张失败就报错。
function observeUploads(win, editor, expected, signal) {
  if (expected === 0) return { promise: Promise.resolve(), cancel() {} }
  let cancel = () => {}
  const promise = new Promise((resolve, reject) => {
    let completed = 0
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      win.clearTimeout(timer)
      editor.removeListener('fileUploadResponse', onResponse)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    cancel = () => finish()
    const onAbort = () => finish(new DOMException('已停止导入', 'AbortError'))
    const onResponse = (event) => {
      const status = event?.data?.fileLoader?.xhr?.status
      const message = event?.data?.message
      if (message || (Number.isFinite(status) && status >= 400)) {
        finish(new Error(`阿里云市场：图片上传失败${message ? `：${message}` : `（HTTP ${status}）`}`))
        return
      }
      completed += 1
      if (completed >= expected) finish()
    }
    const timer = win.setTimeout(() => finish(new Error('阿里云市场：图片上传响应超时')), UPLOAD_TIMEOUT_MS)
    editor.on('fileUploadResponse', onResponse)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
  return { promise, cancel }
}

export default {
  id: 'aliyun-market',
  name: '阿里云市场',
  hosts: ['msp.aliyun.com'],
  format: 'html',
  match(url) {
    return hostMatches(url, this.hosts)
      && /^\/msp\/commodity\/list\/~\/publish\/basic\/?$/.test(url.pathname)
      && Boolean(url.searchParams.get('commodityId'))
  },
  // 阿里云市场没有标题字段。
  findTitle() {
    return null
  },
  findEditor(doc, win) {
    const editor = findAliyunDetailEditor(doc, win)
    return {
      getText: () => editor.getData() ?? '',
      async setHTML(html) {
        const embedded = imageSources(html).filter(source => /^data:image\//i.test(source)).length
        const observation = observeUploads(win, editor, embedded, null)
        try {
          editor.focus?.()
          // 不用 setData('')：它会重建 iframe，让已锁定的编辑区失效。改走 CKEditor 自己的粘贴流水线。
          const range = editor.createRange()
          range.selectNodeContents(editor.editable())
          editor.getSelection().selectRanges([range])
          editor.fire('paste', { type: 'html', method: 'paste', dataValue: html })
          await observation.promise
          const deadline = Date.now() + UPLOAD_TIMEOUT_MS
          while (embedded > 0 && Date.now() < deadline) {
            const pending = imageSources(editor.getData() ?? '').some(source => /^(?:data:image\/|blob:)/i.test(source))
            if (!pending) break
            await waitMs(win, 100)
          }
        } catch (error) {
          observation.cancel()
          for (const loader of Object.values(editor.uploadRepository?.loaders ?? {})) loader.abort?.()
          throw error
        }
        if (squash(editor.getData() ?? '').length === 0 && squash(html).length > 0) {
          throw new Error('阿里云市场：产品详情写入后为空，已停下')
        }
      },
    }
  },
  writeTitle: null,
}
