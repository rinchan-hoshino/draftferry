import { squash, waitMs } from '../dom.js'
import { hostMatches } from './shared.js'

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

function imageSources(doc, html) {
  const container = doc.createElement('div')
  container.innerHTML = html
  return [...container.querySelectorAll('img')].map(img => img.getAttribute('src')?.trim() ?? '')
}

function setCkEditorData(win, editor, html) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      win.clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = win.setTimeout(() => finish(new Error('阿里云市场：恢复原产品详情超时')), 5000)
    try {
      editor.setData(html, { callback: () => finish() })
    } catch (error) {
      finish(error)
    }
  })
}

function observeUploads(win, editor, expected, onProgress) {
  if (expected === 0) return { promise: Promise.resolve(), cancel() {} }
  let cancel = () => {}
  const promise = new Promise((resolve, reject) => {
    let completed = 0
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      win.clearTimeout(timer)
      editor.removeListener?.('fileUploadResponse', onResponse)
      if (error) reject(error)
      else resolve()
    }
    cancel = () => finish()
    const onResponse = (event) => {
      const status = event?.data?.fileLoader?.xhr?.status
      const message = event?.data?.message
      if (message || (Number.isFinite(status) && status >= 400)) {
        finish(new Error(`阿里云市场：图片上传失败${message ? `：${message}` : `（HTTP ${status}）`}`))
        return
      }
      completed += 1
      onProgress?.(`上传图片 ${completed}/${expected}…`)
      if (completed >= expected) finish()
    }
    const timer = win.setTimeout(() => finish(new Error('阿里云市场：图片上传响应超时')), UPLOAD_TIMEOUT_MS)
    editor.on('fileUploadResponse', onResponse)
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
  findTitle() {
    return null
  },
  findEditor(doc, win) {
    const editor = findAliyunDetailEditor(doc, win)
    return {
      getText: () => editor.getData() ?? '',
      async setHTML(html, { onProgress } = {}) {
        const previous = editor.getData() ?? ''
        const embedded = imageSources(doc, html).filter(source => /^data:image\//i.test(source)).length
        if (embedded > 0) onProgress?.(`上传图片 0/${embedded}…`)
        else onProgress?.('写入正文…')
        const observation = observeUploads(win, editor, embedded, onProgress)
        try {
          editor.focus?.()
          // 走 CKEditor 原生选区 + paste 整篇替换，避免 setData 重建 iframe。
          const range = editor.createRange()
          range.selectNodeContents(editor.editable())
          editor.getSelection().selectRanges([range])
          editor.fire('paste', { type: 'html', method: 'paste', dataValue: html })
          await observation.promise
          const deadline = Date.now() + UPLOAD_TIMEOUT_MS
          while (embedded > 0 && Date.now() < deadline) {
            const pending = imageSources(doc, editor.getData() ?? '').some(src => /^(?:data:image\/|blob:)/i.test(src))
            if (!pending) break
            await waitMs(win, 100)
          }
          if (embedded > 0 && imageSources(doc, editor.getData() ?? '').some(src => /^(?:data:image\/|blob:)/i.test(src))) {
            throw new Error('阿里云市场：内嵌图片未完成平台上传')
          }
          if (squash(editor.getData() ?? '').length === 0 && squash(html).length > 0) {
            throw new Error('阿里云市场：产品详情写入后为空，已恢复原稿')
          }
        } catch (error) {
          observation.cancel()
          for (const loader of Object.values(editor.uploadRepository?.loaders ?? {})) loader.abort?.()
          try {
            await setCkEditorData(win, editor, previous)
          } catch (restoreError) {
            throw new AggregateError([error, restoreError], '阿里云市场：导入失败且无法恢复原产品详情；请刷新页面且不要保存', { cause: restoreError })
          }
          throw error
        }
      },
    }
  },
  writeTitle: null,
}
