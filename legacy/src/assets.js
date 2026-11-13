import { normalizeImagePath } from './draft.js'

export class AssetIssue extends Error {
  constructor(message, assets, kind = 'failed') {
    super(message)
    this.name = 'AssetIssue'
    this.assets = assets
    this.kind = kind
  }
}

export function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('已停止导入', 'AbortError')
}

export function abortable(promise, signal) {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('已停止导入', 'AbortError'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function readImage(windowObject, file, signal) {
  return new Promise((resolve, reject) => {
    const reader = new windowObject.FileReader()
    const abort = () => reader.abort()
    const finish = (error, value) => {
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(value)
    }
    reader.onload = () => finish(null, String(reader.result))
    reader.onerror = () => finish(new Error(`无法读取图片：${file.name}`))
    reader.onabort = () => finish(new DOMException('已停止导入', 'AbortError'))
    if (signal?.aborted) { finish(new DOMException('已停止导入', 'AbortError')); return }
    signal?.addEventListener('abort', abort, { once: true })
    const extension = file.name?.split('.').at(-1)?.toLowerCase()
    const inferred = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' }[extension]
    reader.readAsDataURL(!file.type && inferred ? file.slice(0, file.size, inferred) : file)
  })
}

// A pool belongs to one draft. Cache only completed work, across retries.
export class AssetPool {
  constructor(draft, { renderMermaid, localImages = new Map() } = {}) {
    this.draft = draft
    this.renderMermaid = renderMermaid
    this.files = new Map(localImages)
    this.prepared = new Map()
    this.status = new Map(draft.assets.map(asset => [asset.id, { ...asset, status: 'pending' }]))
  }

  addFiles(files) {
    const incoming = new Map()
    for (const file of files) {
      if (!file.type?.startsWith('image/') && !/\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.name)) continue
      const path = normalizeImagePath(file.webkitRelativePath || file.name)
      if (incoming.has(path)) throw new Error(`存在同名本地图片：${path}，请分别选择`)
      incoming.set(path, file)
    }
    for (const [path, file] of incoming) this.files.set(path, file)
  }

  findLocal(source) {
    const path = normalizeImagePath(source)
    if (this.files.has(path)) return this.files.get(path)
    const name = path.split('/').at(-1)
    const references = this.draft.assets.filter(asset => asset.kind === 'local'
      && normalizeImagePath(asset.source).split('/').at(-1) === name)
    if (references.length > 1) throw new Error(`稿件引用了多个同名图片：${name}。请将图片改为不同文件名并更新 Markdown 后重新导入。`)
    const candidates = [...this.files].filter(([key]) => normalizeImagePath(key).split('/').at(-1) === name)
    if (candidates.length > 1) throw new Error(`同名图片无法区分：${source}，请按原目录选择`)
    return candidates[0]?.[1]
  }

  snapshot() { return [...this.status.values()].map(asset => ({ ...asset })) }

  async prepare({ signal, onProgress = () => {} } = {}) {
    const missing = []
    for (const asset of this.draft.assets) {
      if (asset.kind === 'local' && !this.prepared.has(asset.id)) {
        const available = Boolean(this.findLocal(asset.source))
        this.status.set(asset.id, { ...asset, status: available ? 'pending' : 'missing' })
        if (!available) missing.push(asset)
      }
    }
    onProgress(this.snapshot())
    if (missing.length) throw new AssetIssue(`找不到本地图片：${missing.map(asset => asset.source).join('、')}`, missing, 'missing')
    for (const asset of this.draft.assets) {
      assertNotAborted(signal)
      if (this.prepared.has(asset.id)) continue
      this.status.set(asset.id, { ...asset, status: 'preparing' })
      onProgress(this.snapshot())
      try {
        let value = asset.source
        if (asset.kind === 'local') {
          const file = this.findLocal(asset.source)
          value = typeof file === 'string' ? file : await readImage(this.draft.windowObject, file, signal)
        } else if (asset.kind === 'mermaid') {
          if (!this.renderMermaid) throw new Error('缺少 Mermaid PNG 转换器')
          value = await abortable(this.renderMermaid(asset.source, asset.index), signal)
          if (!/^data:image\/png;base64,/i.test(value)) throw new Error(`${asset.name}没有生成 PNG`)
        }
        assertNotAborted(signal)
        this.prepared.set(asset.id, value)
        this.status.set(asset.id, { ...asset, status: 'ready' })
        onProgress(this.snapshot())
      } catch (error) {
        if (signal?.aborted) throw error
        this.status.set(asset.id, { ...asset, status: 'failed', error: error.message })
        onProgress(this.snapshot())
        throw new AssetIssue(`${asset.name}：${error.message}`, [asset])
      }
    }
    return this.prepared
  }
}
