import { buildDiagnostic } from './diagnostic.ts'
import { runImport } from './import.ts'
import { createArticleBuilder } from './markdown.ts'
import { createMermaidRenderer } from './mermaid.ts'
import { mountPanel, type MountedPanel } from './panel.tsx'
import { detectPlatform } from './platforms/index.ts'
import { observeRoute } from './route.ts'
import type { ImportProbe, ImportResult } from './types.ts'

declare const __FOLIO_VERSION__: string
declare const unsafeWindow: Window | undefined

function getPageWindow(): Window {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document) return unsafeWindow
  } catch {
    /* userscript manager without unsafeWindow bridge */
  }
  return window
}

const pageWindow = getPageWindow()
const buildArticle = createArticleBuilder({
  window,
  renderMermaid: createMermaidRenderer(),
})

function warningsOf(result: ImportResult): string[] {
  const warnings: string[] = []
  if (result.titleMissing) warnings.push('未找到标题框，标题未填')
  if (result.missing.length) warnings.push(`缺少图片：${result.missing.join('、')}，已留占位`)
  if (result.mermaidErrors.length) {
    warnings.push(...result.mermaidErrors, '渲染失败的图表已保留原代码块')
  }
  return warnings
}

let panel: MountedPanel | null = null

function syncMount(): void {
  const platform = detectPlatform(new URL(pageWindow.location.href))
  if (!platform) {
    panel?.destroy()
    panel = null
    return
  }
  if (panel) {
    panel.setPlatform(platform)
    return
  }
  panel = mountPanel(document, {
    platform,
    run: async ({ files, text, onProgress }) => {
      const probe: ImportProbe = {}
      try {
        const result = await runImport({
          pageWindow,
          url: new URL(pageWindow.location.href),
          files,
          text,
          buildArticle,
          onProgress,
          probe,
        })
        const summary = result.title
          ? `${result.title} · ${result.imageCount} 张图`
          : `${result.imageCount} 张图`
        return { kind: 'ok', text: `已导入：${summary}`, warnings: warningsOf(result) }
      } catch (error) {
        return {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
          diagnostic: buildDiagnostic({
            version: typeof __FOLIO_VERSION__ !== 'undefined' ? __FOLIO_VERSION__ : '2.0.0',
            pageUrl: pageWindow.location.href,
            platformId: probe.platformId,
            editorFound: probe.editorFound,
            titleFound: probe.titleFound,
            stage: probe.stage,
            error,
          }),
        }
      }
    },
  })
}

syncMount()
observeRoute(pageWindow, syncMount)
