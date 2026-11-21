export type PlatformId =
  | 'zhihu'
  | 'wechat'
  | 'oschina'
  | 'baijiahao'
  | 'toutiao'
  | 'sohu'
  | 'aliyun-market'
  | 'tencent-market'

export type ProgressCallback = (stageText: string) => void

export interface EditorHandle {
  getText: () => string
  setHTML: (
    html: string,
    options?: { markdown?: string; onProgress?: ProgressCallback },
  ) => void | Promise<void>
}

export interface PlatformAdapter {
  id: PlatformId
  name: string
  hosts: readonly string[]
  format?: 'markdown' | 'html'
  match: (url: URL) => boolean
  findTitle: (doc: Document) => HTMLElement | null
  findEditor: (doc: Document, win: Window) => EditorHandle
  writeTitle: ((win: Window, control: HTMLElement, title: string) => void) | null
}

export interface ArticleResult {
  title: string
  markdown: string
  html: string
  imageCount: number
  missing: string[]
  mermaidErrors: string[]
}

export type MermaidRenderer = (source: string) => Promise<string>

export interface BuildArticleOptions {
  fallbackTitle?: string
  files?: Map<string, File>
  onProgress?: ProgressCallback
}

export type ArticleBuilder = (
  source: string,
  options?: BuildArticleOptions,
) => Promise<ArticleResult>

export interface ImportProbe {
  stage?: string
  platformId?: PlatformId | null
  editorFound?: boolean
  titleFound?: boolean
}

export interface ImportResult {
  platformName: string
  title: string
  imageCount: number
  missing: string[]
  mermaidErrors: string[]
  titleMissing: boolean
  titleUnsupported: boolean
}

export interface PanelOutcome {
  kind: 'ok' | 'error' | ''
  text: string
  warnings?: string[]
  diagnostic?: string
}

export interface PanelRunPayload {
  files: File[]
  text: string
  onProgress: ProgressCallback
}
