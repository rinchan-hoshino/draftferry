import { squash, waitMs } from '../dom.ts'
import type { PlatformAdapter, ProgressCallback } from '../types.ts'
import { hostMatches } from './shared.ts'

const LABELS = ['产品详情', '商品详情']
const UPLOAD_TIMEOUT_MS = 30_000

interface CkEditorInstance {
  mode?: string
  readOnly?: boolean
  editable: () => unknown
  createRange: () => { selectNodeContents: (node: unknown) => void }
  getSelection: () => { selectRanges: (ranges: unknown[]) => void }
  getData: () => string
  setData: (html: string, options?: { callback?: () => void }) => void
  fire: (name: string, payload?: unknown) => void
  focus?: () => void
  on: (name: string, handler: (event: CkUploadEvent) => void) => void
  removeListener?: (name: string, handler: (event: CkUploadEvent) => void) => void
  uploadRepository?: { loaders?: Record<string, { abort?: () => void }> }
}

interface CkUploadEvent {
  data?: {
    fileLoader?: { xhr?: { status?: number } }
    message?: string
  }
}

function normalizedLabel(element: Element): string {
  return element.textContent?.replace(/\s+/g, '').replace(/^[*＊]+|[：:*＊]+$/g, '') ?? ''
}

export function findAliyunDetailEditor(doc: Document, win: Window): CkEditorInstance {
  const label = [...doc.querySelectorAll('label')].find((element) =>
    LABELS.includes(normalizedLabel(element)),
  )
  const formItem = label?.closest('.acpn-form-item, .next-form-item')
  const wrapper = formItem?.querySelector('.cke[class*="cke_editor_"]')
  const instanceClass = wrapper
    ? [...wrapper.classList].find((name) => /^cke_editor_.+/.test(name))
    : null
  const ckInstances = (
    win as unknown as { CKEDITOR?: { instances?: Record<string, CkEditorInstance> } }
  ).CKEDITOR?.instances
  const editor = instanceClass
    ? ckInstances?.[instanceClass.replace(/^cke_editor_/, '')]
    : undefined
  if (!label || !formItem || !wrapper || !editor) {
    throw new Error('阿里云市场：未找到“产品详情”CKEditor 实例')
  }
  const required = [
    'getData',
    'setData',
    'fire',
    'editable',
    'createRange',
    'getSelection',
  ] as const
  for (const name of required) {
    if (typeof editor[name] !== 'function') {
      throw new Error('阿里云市场：产品详情 CKEditor 接口不完整')
    }
  }
  if (!editor.editable() || editor.readOnly || (editor.mode && editor.mode !== 'wysiwyg')) {
    throw new Error('阿里云市场：请等待产品详情加载完成，并切换到可编辑的富文本模式')
  }
  return editor
}

function imageSources(doc: Document, html: string): string[] {
  const container = doc.createElement('div')
  container.innerHTML = html
  return [...container.querySelectorAll('img')].map((img) => img.getAttribute('src')?.trim() ?? '')
}

function setCkEditorData(win: Window, editor: CkEditorInstance, html: string): Promise<void> {
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
      () => finish(new Error('阿里云市场：恢复原产品详情超时')),
      5000,
    )
    try {
      editor.setData(html, { callback: () => finish() })
    } catch (error) {
      finish(error)
    }
  })
}

function observeUploads(
  win: Window,
  editor: CkEditorInstance,
  expected: number,
  onProgress?: ProgressCallback,
): { promise: Promise<void>; cancel: () => void } {
  if (expected === 0) return { promise: Promise.resolve(), cancel() {} }
  let cancel = () => {}
  const promise = new Promise<void>((resolve, reject) => {
    let completed = 0
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      win.clearTimeout(timer)
      editor.removeListener?.('fileUploadResponse', onResponse)
      if (error) reject(error instanceof Error ? error : new Error(String(error)))
      else resolve()
    }
    cancel = () => finish()
    const onResponse = (event: CkUploadEvent) => {
      const status = event?.data?.fileLoader?.xhr?.status
      const message = event?.data?.message
      if (message || (typeof status === 'number' && Number.isFinite(status) && status >= 400)) {
        finish(
          new Error(
            `阿里云市场：图片上传失败${message ? `：${message}` : `（HTTP ${status}）`}`,
          ),
        )
        return
      }
      completed += 1
      onProgress?.(`上传图片 ${completed}/${expected}…`)
      if (completed >= expected) finish()
    }
    const timer = win.setTimeout(
      () => finish(new Error('阿里云市场：图片上传响应超时')),
      UPLOAD_TIMEOUT_MS,
    )
    editor.on('fileUploadResponse', onResponse)
  })
  return { promise, cancel }
}

const aliyun: PlatformAdapter = {
  id: 'aliyun-market',
  name: '阿里云市场',
  hosts: ['msp.aliyun.com'],
  format: 'html',
  match(url) {
    return (
      hostMatches(url, this.hosts) &&
      /^\/msp\/commodity\/list\/~\/publish\/basic\/?$/.test(url.pathname) &&
      Boolean(url.searchParams.get('commodityId'))
    )
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
        const embedded = imageSources(doc, html).filter((source) =>
          /^data:image\//i.test(source),
        ).length
        if (embedded > 0) onProgress?.(`上传图片 0/${embedded}…`)
        else onProgress?.('写入正文…')
        const observation = observeUploads(win, editor, embedded, onProgress)
        try {
          editor.focus?.()
          // Use CKEditor native selection + paste replacement to avoid rebuilding iframe via setData
          const range = editor.createRange()
          range.selectNodeContents(editor.editable())
          editor.getSelection().selectRanges([range])
          editor.fire('paste', { type: 'html', method: 'paste', dataValue: html })
          await observation.promise
          const deadline = Date.now() + UPLOAD_TIMEOUT_MS
          while (embedded > 0 && Date.now() < deadline) {
            const pending = imageSources(doc, editor.getData() ?? '').some((src) =>
              /^(?:data:image\/|blob:)/i.test(src),
            )
            if (!pending) break
            await waitMs(win, 100)
          }
          if (
            embedded > 0 &&
            imageSources(doc, editor.getData() ?? '').some((src) =>
              /^(?:data:image\/|blob:)/i.test(src),
            )
          ) {
            throw new Error('阿里云市场：内嵌图片未完成平台上传')
          }
          if (squash(editor.getData() ?? '').length === 0 && squash(html).length > 0) {
            throw new Error('阿里云市场：产品详情写入后为空，已恢复原稿')
          }
        } catch (error) {
          observation.cancel()
          for (const loader of Object.values(editor.uploadRepository?.loaders ?? {})) {
            loader.abort?.()
          }
          try {
            await setCkEditorData(win, editor, previous)
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              '阿里云市场：导入失败且无法恢复原产品详情；请刷新页面且不要保存',
              { cause: restoreError },
            )
          }
          throw error
        }
      },
    }
  },
  writeTitle: null,
}

export default aliyun
