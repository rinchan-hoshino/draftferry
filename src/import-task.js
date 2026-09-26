import { createDraft, renderDraft } from './draft.js'
import { AssetPool, AssetIssue, abortable, assertNotAborted } from './assets.js'

export const BUSY_PHASES = new Set(['reading', 'preparing', 'importing', 'pausing'])

export class ImportTask {
  constructor({ windowObject, renderMermaid, locateTarget, onChange = () => {} }) {
    this.windowObject = windowObject
    this.renderMermaid = renderMermaid
    this.locateTarget = locateTarget
    this.onChange = onChange
    this.epoch = 0
    this.uploadCache = new Map()
    this.state = { phase: 'idle', assets: [], message: '', filename: '', title: '' }
  }

  get busy() { return BUSY_PHASES.has(this.state.phase) }

  update(patch) {
    this.state = { ...this.state, ...patch, canResume: Boolean(this.pool || this.selectedFiles) }
    this.onChange(this.state)
  }

  async start(files, context) {
    if (this.busy) return
    const markdownFiles = files.filter(file => /\.(?:md|markdown)$/i.test(file.name))
    if (markdownFiles.length !== 1) {
      this.update({ phase: 'invalid', message: '每次请选择一篇 Markdown，可同时选择它的图片。' })
      return
    }
    const [file] = markdownFiles
    this.selectedFiles = files
    this.cancelAttempt()
    const epoch = ++this.epoch
    const controller = new this.windowObject.AbortController()
    this.controller = controller
    this.context = context
    this.pauseMessage = null
    this.draft = null
    this.pool = null
    this.target = null
    this.article = null
    this.uploadCache = new Map()
    this.update({ phase: 'reading', filename: file.name, title: '', assets: [], destination: context.destination, message: '正在读取稿件…', result: null, retryLabel: '重试未完成项' })
    try {
      const markdown = await abortable(file.text(), controller.signal)
      if (epoch !== this.epoch) return
      this.draft = createDraft(markdown, { windowObject: this.windowObject, filename: file.name })
      this.pool = new AssetPool(this.draft, { renderMermaid: this.renderMermaid })
      this.pool.addFiles(files)
      this.update({ title: this.draft.title || file.name.replace(/\.(md|markdown)$/i, '') })
      await this.run(context, epoch, controller)
    } catch (error) {
      this.fail(error, epoch)
    }
  }

  async resume(context, files = []) {
    if (this.busy || !this.context) return
    if (!context || context.platformId !== this.context.platformId) {
      this.update({ phase: 'paused', message: `请回到${this.context.destination}，再继续这篇稿件。` })
      return
    }
    if (!this.pool) {
      if (this.selectedFiles) await this.start([...this.selectedFiles, ...files], context)
      return
    }
    try { this.pool.addFiles(files) } catch (error) { this.update({ phase: 'failed', message: error.message }); return }
    this.cancelAttempt()
    const controller = new this.windowObject.AbortController()
    this.controller = controller
    this.pauseMessage = null
    await this.run(context, ++this.epoch, controller)
  }

  async run(context, epoch, controller) {
    const signal = controller.signal
    const current = () => {
      assertNotAborted(signal)
      if (epoch !== this.epoch || this.windowObject.location.href !== context.url) {
        throw new DOMException('页面已切换', 'AbortError')
      }
    }
    this.context = context
    try {
      current()
      this.update({ phase: 'preparing', message: '正在准备正文和图片…', destination: context.destination })
      const prepared = await this.pool.prepare({ signal, onProgress: assets => {
        if (epoch === this.epoch && !signal.aborted) this.update({ assets })
      } })
      current()
      this.article = renderDraft(this.draft, prepared)
      const target = this.locateTarget(context)
      if (!this.target || !target.sameAs(this.target)) this.uploadCache = new Map()
      this.target = target
      this.update({ phase: 'importing', message: `正在填入${context.field}，编辑区域暂时锁定…`,
        retryLabel: target.capabilities?.retryUploadedImages ? '重试未完成项' : '重试导入' })
      const result = await target.commit(this.article, {
        signal,
        uploadCache: this.uploadCache,
        assetNames: new Map(this.draft.assets.map(asset => [prepared.get(asset.id), asset.name])),
        onProgress: message => { if (epoch === this.epoch && !signal.aborted) this.update({ message }) },
        onAssetProgress: progress => {
          if (epoch !== this.epoch || signal.aborted) return
          const asset = this.draft.assets.find(asset => prepared.get(asset.id) === progress.source)
          if (!asset) return
          this.update({ assets: this.state.assets.map(item => item.id === asset.id ? { ...item, status: progress.status } : item) })
        },
      })
      current()
      this.update({ phase: 'done', message: `已填入${context.field}`, result, summary: {
        imageCount: this.article.imageCount, mermaidCount: this.article.mermaidCount,
        tableCount: this.article.tableCount, codeCount: this.article.codeCount,
      } })
    } catch (error) {
      this.fail(error, epoch)
    }
  }

  fail(error, epoch) {
    if (epoch !== this.epoch) return
    const restoreFailed = error?.name === 'AggregateError' || /无法恢复|恢复失败|不要保存/.test(error?.message ?? '')
    const cancelled = !restoreFailed && (this.controller?.signal.aborted || error?.name === 'AbortError' || error?.message === '已取消导入')
    this.update({
      phase: cancelled ? 'paused' : error instanceof AssetIssue && error.kind === 'missing' ? 'missing' : 'failed',
      message: cancelled ? this.pauseMessage || '导入已暂停，稿件与准备好的图片仍在这里。' : error.message || String(error),
    })
  }

  cancelAttempt() { this.controller?.abort() }

  pause(message = '导入已暂停，稿件与准备好的图片仍在这里。') {
    if (!this.busy || this.state.phase === 'pausing') return
    this.pauseMessage = message
    this.update({ phase: 'pausing', message: '正在结束本次处理，稿件会保留在这里…' })
    this.cancelAttempt()
  }

  checkRoute() {
    if (this.busy && this.context?.url !== this.windowObject.location.href) {
      this.pause('页面已切换。回到目标页面后，可以继续这篇稿件。')
    }
  }

  destroy() {
    this.cancelAttempt()
    this.epoch++
    this.onChange = () => {}
  }
}
