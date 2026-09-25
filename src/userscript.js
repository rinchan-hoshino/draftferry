/* global __DRAFTFERRY_VERSION__, unsafeWindow */
import { renderMarkdownArticle } from './core.js'
import {
  buildDiagnosticFile,
  downloadDiagnosticFile,
} from './diagnostic-file.js'
import { renderMermaidPng } from './mermaid-png.js'
import { createPanel, PANEL_ID } from './panel.js'
import {
  detectPlatform,
  getPlatformById,
  injectPlatformArticle,
} from './platforms.js'

let mountedPanel

function getPageWindow() {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document) {
      return unsafeWindow
    }
  } catch {
    // Fall back to the userscript window when the manager exposes no page bridge.
  }
  return window
}

function currentPlatform() {
  const fixturePlatformId = document.querySelector(
    'meta[name="rin-platform-fixture"]',
  )?.content
  if (window.location.protocol === 'file:' && fixturePlatformId) {
    return getPlatformById(fixturePlatformId)
  }
  return detectPlatform(window.location)
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function collectLocalImages(files) {
  const images = new Map()
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      continue
    }
    if (images.has(file.name)) {
      throw new Error(`存在同名本地图片，无法确定引用关系：${file.name}`)
    }
    const dataUrl = await readFileAsDataUrl(file)
    images.set(file.name, dataUrl)
    if (file.webkitRelativePath) {
      images.set(file.webkitRelativePath.replaceAll('\\', '/'), dataUrl)
    }
  }
  return images
}

function createImportPanel() {
  const platform = currentPlatform()
  const panel = createPanel(document, platform.name)
  const { button, diagnoseButton, fileInput, setStatus } = panel
  let selectedUrl
  let job
  const checkRoute = () => {
    if (job && job.url !== window.location.href) job.controller.abort()
  }

  button.addEventListener('click', () => {
    if (job) return
    const platform = currentPlatform()
    if (!platform) {
      setStatus('当前页面不是已支持的平台', 'error')
      return
    }
    fileInput.value = ''
    selectedUrl = window.location.href
    fileInput.click()
  })

  diagnoseButton.addEventListener('click', () => {
    const platform = currentPlatform()
    if (!platform) {
      setStatus('当前页面不是已支持的平台', 'error')
      return
    }
    setStatus('正在准备诊断文件…', 'busy')
    try {
      const pageWindow = getPageWindow()
      const runtimeDocument = pageWindow.document ?? document
      const diagnostics = buildDiagnosticFile({
        document: runtimeDocument,
        pageWindow,
        platformId: platform.id,
        version: __DRAFTFERRY_VERSION__,
      })
      const filename = downloadDiagnosticFile({
        windowObject: pageWindow,
        document: runtimeDocument,
        text: diagnostics,
        platformId: platform.id,
        version: __DRAFTFERRY_VERSION__,
      })
      setStatus(`诊断已下载：${filename}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    }
  })

  fileInput.addEventListener('change', async () => {
    if (job) return
    const files = [...fileInput.files]
    if (files.length === 0) return
    const markdownFiles = files.filter((file) => /\.(?:md|markdown)$/i.test(file.name))
    if (markdownFiles.length !== 1) {
      setStatus('每次请选择一个 .md 或 .markdown 文件，可同时选择多张图片', 'error')
      return
    }
    if (selectedUrl && selectedUrl !== window.location.href) {
      setStatus('页面已切换，请在目标页面重新选择文件', 'error')
      return
    }

    const platform = currentPlatform()
    if (!platform) {
      setStatus('当前页面不是已支持的平台', 'error')
      return
    }

    const controller = new window.AbortController()
    job = { controller, url: window.location.href }
    setStatus(`正在为${platform.name}转换 Markdown 和 Mermaid…`, 'busy')
    try {
      const [markdown, localImages] = await Promise.all([
        markdownFiles[0].text(),
        collectLocalImages(files),
      ])
      const article = await renderMarkdownArticle(markdown, {
        windowObject: window,
        localImages,
        renderMermaid: renderMermaidPng,
      })
      checkRoute()
      if (controller.signal.aborted) throw new Error('页面已切换，已停止导入')
      setStatus(`正在填入${platform.name}，编辑区域暂时锁定…`, 'busy')
      await injectPlatformArticle(document, article, {
        fixturePlatformId: platform.id,
        pageWindow: getPageWindow(),
        signal: controller.signal,
        onProgress: (message) => setStatus(message, 'busy'),
      })
      checkRoute()
      if (controller.signal.aborted) throw new Error('页面已切换，已停止导入')
      setStatus(
        `${platform.name}已填入${article.mermaidCount ? `，含 ${article.mermaidCount} 张 Mermaid PNG` : ''}；请预览后手动保存`,
      )
    } catch (error) {
      console.error('[稿渡 · Markdown 一键排版]', error)
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      job = null
      fileInput.value = ''
    }
  })

  return {
    ...panel,
    checkRoute,
    destroy() {
      job?.controller.abort()
      panel.destroy()
    },
  }
}

function syncPanel() {
  mountedPanel?.checkRoute()
  const panel = document.getElementById(PANEL_ID)
  if (!currentPlatform()) {
    mountedPanel?.destroy()
    mountedPanel = null
    panel?.remove()
    return
  }
  if (!panel && document.body) {
    mountedPanel?.destroy()
    mountedPanel = createImportPanel()
    document.body.append(mountedPanel.host)
  }
}

syncPanel()
new MutationObserver(syncPanel).observe(document.body, { childList: true })
window.addEventListener('popstate', syncPanel)
window.addEventListener('hashchange', syncPanel)
window.navigation?.addEventListener?.('currententrychange', syncPanel)
