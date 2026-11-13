/* global __DRAFTFERRY_VERSION__, unsafeWindow */
import { createArticleBuilder } from './article.js'
import { buildDiagnostic } from './diagnostic.js'
import { createMermaidRenderer } from './mermaid.js'
import { runImport } from './import.js'
import { mountPanel } from './panel.js'
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
  if (result.titleMissing) warnings.push('没找到标题框，标题没填')
  if (result.titleUnsupported) warnings.push('这个平台没有标题框，标题没填')
  if (result.missing.length) warnings.push(`找不到图片：${result.missing.join('、')}，已在正文里留了占位`)
  if (result.mermaidErrors.length) warnings.push(`${result.mermaidErrors.length} 个 Mermaid 图没渲出来，保留成了代码块`)
  return warnings
}

mountPanel(document, {
  heading: () => {
    const platform = detectPlatform(new URL(pageWindow.location.href))
    return platform ? `导入到 ${platform.name}` : '稿渡'
  },
  run: async ({ files, text }) => {
    const probe = {}
    try {
      const result = await runImport({ pageWindow, url: new URL(pageWindow.location.href), files, text, buildArticle, probe })
      const label = result.title ? `${result.title} + ${result.imageCount} 张图` : `${result.imageCount} 张图`
      return { kind: 'ok', text: `导入好了：${label}`, warnings: warningsOf(result) }
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
          error,
        }),
      }
    }
  },
})
