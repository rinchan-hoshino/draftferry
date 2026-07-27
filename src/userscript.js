/* global unsafeWindow */
import { renderMarkdownArticle } from './core.js'
import { renderMermaidPng } from './mermaid-png.js'
import {
  detectPlatform,
  getPlatformById,
  injectPlatformArticle,
} from './platforms.js'

const PANEL_ID = 'rin-draftferry-panel'

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

function findMarkdownFile(files) {
  return files.find((file) => /\.(?:md|markdown)$/i.test(file.name))
}

function createPanel() {
  const panel = document.createElement('section')
  panel.id = PANEL_ID
  const platformAtCreation = currentPlatform()
  panel.setAttribute('aria-label', '稿渡 · Markdown 一键排版 Preview')
  panel.innerHTML = `
    <button type="button" data-rin-action="import">导入 Markdown</button>
    <span data-rin-status>${platformAtCreation ? `${platformAtCreation.name} · 稿渡 Preview` : '当前平台未支持'}</span>
    <input data-rin-files type="file" accept=".md,.markdown,image/*" multiple hidden style="display:none !important">
  `
  panel.setAttribute('style', [
    'position: fixed',
    'right: 24px',
    'bottom: 24px',
    'z-index: 2147483647',
    'display: flex',
    'align-items: center',
    'gap: 10px',
    'max-width: 420px',
    'padding: 12px',
    'border: 1px solid #e0c36c',
    'border-radius: 8px',
    'background: #fffdf5',
    'box-shadow: 0 6px 24px rgba(0,0,0,.16)',
    'font: 14px/1.4 system-ui, sans-serif',
    'color: #333',
  ].join(';'))

  const button = panel.querySelector('[data-rin-action="import"]')
  button.setAttribute('style', [
    'border: 0',
    'border-radius: 6px',
    'padding: 8px 13px',
    'background: #d8a522',
    'color: #fff',
    'font-weight: 700',
    'cursor: pointer',
    'white-space: nowrap',
  ].join(';'))

  const status = panel.querySelector('[data-rin-status]')
  const fileInput = panel.querySelector('[data-rin-files]')

  const setStatus = (message, state = 'idle') => {
    status.textContent = message
    status.style.color = state === 'error' ? '#b42318' : '#555'
    button.disabled = state === 'busy'
    button.style.opacity = state === 'busy' ? '.65' : '1'
  }

  button.addEventListener('click', () => {
    const platform = currentPlatform()
    if (!platform) {
      setStatus('当前页面不是已支持的平台', 'error')
      return
    }
    fileInput.value = ''
    fileInput.click()
  })

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files]
    const markdownFile = findMarkdownFile(files)
    if (!markdownFile) {
      setStatus('请选择一个 .md 或 .markdown 文件', 'error')
      return
    }

    const platform = currentPlatform()
    if (!platform) {
      setStatus('当前页面不是已支持的平台', 'error')
      return
    }

    setStatus(`正在为${platform.name}转换 Markdown 和 Mermaid…`, 'busy')
    try {
      const [markdown, localImages] = await Promise.all([
        markdownFile.text(),
        collectLocalImages(files),
      ])
      const article = await renderMarkdownArticle(markdown, {
        windowObject: window,
        localImages,
        renderMermaid: renderMermaidPng,
      })
      const result = await injectPlatformArticle(document, article, {
        fixturePlatformId: platform.id,
        pageWindow: getPageWindow(),
      })
      setStatus(
        `${platform.name}已填入（${result.mode}）${article.mermaidCount ? `，含 ${article.mermaidCount} 张 Mermaid PNG` : ''}；请预览后手动保存`,
      )
    } catch (error) {
      console.error('[稿渡 · Markdown 一键排版]', error)
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    }
  })

  return panel
}

function syncPanel() {
  const panel = document.getElementById(PANEL_ID)
  if (!currentPlatform()) {
    panel?.remove()
    return
  }
  if (!panel && document.body) {
    document.body.append(createPanel())
  }
}

syncPanel()
new MutationObserver(syncPanel).observe(document.body, { childList: true })
window.addEventListener('popstate', syncPanel)
window.addEventListener('hashchange', syncPanel)
window.navigation?.addEventListener?.('currententrychange', syncPanel)
