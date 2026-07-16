import {
  hasExistingSohuDraft,
  injectSohuArticle,
  renderMarkdownArticle,
} from './core.js'
import { renderMermaidPng } from './mermaid-png.js'

const PANEL_ID = 'rin-sohu-markdown-panel'
const EDITOR_SELECTOR = '.ql-editor'

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
  panel.setAttribute('aria-label', '搜狐号 Markdown 一键排版')
  panel.innerHTML = `
    <button type="button" data-rin-action="import">导入 Markdown</button>
    <span data-rin-status>进入文章编辑页后即可导入</span>
    <input data-rin-files type="file" accept=".md,.markdown,image/*" multiple hidden>
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
    if (!document.querySelector(EDITOR_SELECTOR)) {
      setStatus('请先进入搜狐号文章编辑页', 'error')
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

    const editor = document.querySelector(EDITOR_SELECTOR)
    if (!editor) {
      setStatus('搜狐正文编辑器已经离开，请重新进入编辑页', 'error')
      return
    }
    if (hasExistingSohuDraft(document)) {
      setStatus('当前标题或正文已有内容；请新建空白文章后再导入', 'error')
      return
    }

    setStatus('正在转换 Markdown 和 Mermaid…', 'busy')
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
      await injectSohuArticle(document, article)
      setStatus(
        `已填入正文${article.mermaidCount ? `，含 ${article.mermaidCount} 张 Mermaid PNG` : ''}；请预览后手动保存`,
      )
    } catch (error) {
      console.error('[搜狐号 Markdown 一键排版]', error)
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    }
  })

  return panel
}

function ensurePanel() {
  if (!document.getElementById(PANEL_ID) && document.body) {
    document.body.append(createPanel())
  }
}

ensurePanel()
new MutationObserver(ensurePanel).observe(document.documentElement, {
  childList: true,
  subtree: true,
})
