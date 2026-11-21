/* global __DRAFTFERRY_VERSION__, unsafeWindow */
import { createArticleBuilder } from './markdown.js'
import { buildDiagnostic } from './diagnostic.js'
import { createMermaidRenderer } from './mermaid.js'
import { runImport } from './import.js'
import { mountPanel } from './panel.js'
import { observeRoute } from './route.js'
import { detectPlatform } from './platforms/index.js'

function getPageWindow() {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document) return unsafeWindow
  } catch { /* 没有页面桥的油猴管理器 */ }
  return window
}

const pageWindow = getPageWindow()
const buildArticle = createArticleBuilder({ window, renderMermaid: createMermaidRenderer() })

function warningsOf(result) {
  const warnings = []
  if (result.titleMissing) warnings.push('未找到标题框，标题未填')
  if (result.missing.length) warnings.push(`缺少图片：${result.missing.join('、')}，已留占位`)
  if (result.mermaidErrors.length) warnings.push(`${result.mermaidErrors.length} 个 Mermaid 图渲染失败，已保留代码块`)
  return warnings
}

let panel = null

function syncMount() {
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
      const probe = {}
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
        const summary = result.title ? `${result.title} · ${result.imageCount} 张图` : `${result.imageCount} 张图`
        return { kind: 'ok', text: `已导入：${summary}`, warnings: warningsOf(result) }
      } catch (error) {
        return {
          kind: 'error',
          text: error?.message || String(error),
          diagnostic: buildDiagnostic({
            version: __DRAFTFERRY_VERSION__,
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
