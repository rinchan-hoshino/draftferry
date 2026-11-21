import { attachPanelPosition } from './position.js'

const MD_PATTERN = /\.(md|markdown)$/i

const CSS = `
:host {
  all: initial;
  color-scheme: light dark;
  position: fixed;
  z-index: 2147483000;
  --bg: light-dark(#ffffffeb, #222326eb);
  --bg-soft: light-dark(#f5f6f8, #2b2d32);
  --bg-hover: light-dark(#eceef2, #34373e);
  --border: light-dark(rgba(15, 23, 42, 0.11), rgba(255, 255, 255, 0.12));
  --border-strong: light-dark(rgba(15, 23, 42, 0.2), rgba(255, 255, 255, 0.22));
  --shadow: light-dark(0 10px 30px rgba(15, 23, 42, 0.12), 0 12px 34px rgba(0, 0, 0, 0.48));
  --shadow-sm: light-dark(0 4px 14px rgba(15, 23, 42, 0.10), 0 6px 18px rgba(0, 0, 0, 0.42));
  --text: light-dark(#18191c, #f2f3f5);
  --text-sub: light-dark(#5c6370, #a0a6b3);
  --text-muted: light-dark(#8b92a0, #767d8a);
  --accent: light-dark(#2563eb, #3b82f6);
  --accent-hover: light-dark(#1d4ed8, #2563eb);
  --accent-soft: light-dark(rgba(37, 99, 235, 0.10), rgba(59, 130, 246, 0.18));
  --ok-text: light-dark(#15803d, #4ade80);
  --ok-bg: light-dark(rgba(22, 163, 74, 0.10), rgba(74, 222, 128, 0.14));
  --warn-text: light-dark(#b45309, #fbbf24);
  --warn-bg: light-dark(rgba(217, 119, 6, 0.10), rgba(251, 191, 36, 0.14));
  --err-text: light-dark(#b91c1c, #f87171);
  --err-bg: light-dark(rgba(220, 38, 38, 0.10), rgba(248, 113, 113, 0.14));
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #222326eb;
    --bg-soft: #2b2d32;
    --bg-hover: #34373e;
    --border: rgba(255, 255, 255, 0.12);
    --border-strong: rgba(255, 255, 255, 0.22);
    --shadow: 0 12px 34px rgba(0, 0, 0, 0.48);
    --shadow-sm: 0 6px 18px rgba(0, 0, 0, 0.42);
    --text: #f2f3f5;
    --text-sub: #a0a6b3;
    --text-muted: #767d8a;
    --accent: #3b82f6;
    --accent-hover: #2563eb;
    --accent-soft: rgba(59, 130, 246, 0.18);
    --ok-text: #4ade80;
    --ok-bg: rgba(74, 222, 128, 0.14);
    --warn-text: #fbbf24;
    --warn-bg: rgba(251, 191, 36, 0.14);
    --err-text: #f87171;
    --err-bg: rgba(248, 113, 113, 0.14);
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.capsule {
  display: inline-flex; align-items: center; height: 34px; padding: 0 4px;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 999px;
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.capsule:hover { border-color: var(--border-strong); box-shadow: var(--shadow); }
.grip {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 26px; border-radius: 999px; color: var(--text-muted);
  cursor: grab; touch-action: none;
}
.grip:hover { color: var(--text-sub); background: var(--bg-soft); }
.grip.dragging { cursor: grabbing; color: var(--text); }
.sep { width: 1px; height: 14px; background: var(--border); margin: 0 2px; }
.toggle {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px 0 8px;
  border-radius: 999px; font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em;
}
.toggle:hover { background: var(--bg-soft); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

.card {
  width: 320px; background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 14px;
  box-shadow: var(--shadow); overflow: hidden;
  backdrop-filter: blur(18px) saturate(1.25); -webkit-backdrop-filter: blur(18px) saturate(1.25);
  font-size: 13px; line-height: 1.45;
}
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 10px 9px 12px; border-bottom: 1px solid var(--border);
}
.head-drag {
  display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0;
  cursor: grab; touch-action: none; user-select: none; padding: 2px 0;
}
.head-drag.dragging { cursor: grabbing; }
.brand { font-size: 12.5px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px; background: var(--bg-soft);
  border: 1px solid var(--border); font-size: 11.5px; font-weight: 500; color: var(--text-sub);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px; color: var(--text-muted); font-size: 16px;
}
.close:hover { background: var(--bg-soft); color: var(--text); }

.body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.drop {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 18px 12px; border: 1.5px dashed var(--border-strong); border-radius: 10px;
  background: var(--bg-soft); color: var(--text-sub); text-align: center; cursor: pointer;
  transition: border-color .15s ease, background .15s ease, color .15s ease;
}
.drop:hover, .drop.over { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.drop-title { font-size: 12.5px; font-weight: 500; color: var(--text); }
.drop-sub { font-size: 11px; color: var(--text-muted); }

.files { display: flex; flex-direction: column; gap: 6px; }
.files-bar {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11.5px; color: var(--text-muted);
}
.clear { font-size: 11.5px; color: var(--text-sub); padding: 1px 4px; border-radius: 4px; }
.clear:hover { color: var(--text); background: var(--bg-hover); }
.tags { display: flex; flex-wrap: wrap; gap: 5px; max-height: 92px; overflow-y: auto; }
.tag {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 3px 6px 3px 8px; border-radius: 6px; font-size: 11.5px;
  background: var(--bg-soft); border: 1px solid var(--border); color: var(--text);
}
.tag.md { background: var(--accent-soft); border-color: transparent; color: var(--accent); font-weight: 500; }
.tag-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 210px; }
.tag-del {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 4px; color: var(--text-muted); font-size: 13px;
}
.tag-del:hover { background: var(--bg-hover); color: var(--text); }

.paste-toggle {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px;
  border-radius: 8px; font-size: 12px; color: var(--text-sub); text-align: left;
  transition: background .15s ease, color .15s ease;
}
.paste-toggle:hover { background: var(--bg-soft); color: var(--text); }
.chev { font-size: 10px; transition: transform .15s ease; display: inline-block; }
.paste-toggle[aria-expanded="true"] .chev { transform: rotate(90deg); }
.paste-input {
  width: 100%; height: 84px; padding: 8px 10px; border-radius: 8px; resize: vertical;
  border: 1px solid var(--border); background: var(--bg-soft); color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.5;
}
.paste-input::placeholder { color: var(--text-muted); }

.status {
  padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.5;
  word-break: break-word; background: var(--bg-soft); color: var(--text-sub);
}
.status.ok { background: var(--ok-bg); color: var(--ok-text); }
.status.warn { background: var(--warn-bg); color: var(--warn-text); }
.status.error { background: var(--err-bg); color: var(--err-text); }

.actions { display: flex; gap: 8px; align-items: center; }
.go {
  flex: 1; height: 34px; padding: 0 14px; border-radius: 9px;
  background: var(--accent); color: #fff; font-size: 13px; font-weight: 500;
  transition: background .15s ease, opacity .15s ease;
}
.go:hover:not(:disabled) { background: var(--accent-hover); }
.go:disabled { opacity: 0.6; cursor: default; }
.diag {
  height: 34px; padding: 0 11px; border-radius: 9px; font-size: 12px; font-weight: 500;
  background: var(--bg-soft); border: 1px solid var(--border); color: var(--text-sub);
  white-space: nowrap;
}
.diag:hover { background: var(--bg-hover); color: var(--text); }

.diag-text {
  width: 100%; height: 88px; padding: 8px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg-soft); color: var(--text);
  font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
`

const GRIP_SVG = '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/><circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/><circle cx="2.5" cy="11.5" r="1.2"/><circle cx="7.5" cy="11.5" r="1.2"/></svg>'

export function mergePendingFiles(existing, incoming) {
  let mdFile = existing.find(file => MD_PATTERN.test(file.name)) ?? null
  const images = new Map()
  for (const file of existing) {
    if (!MD_PATTERN.test(file.name)) images.set(file.name.toLowerCase(), file)
  }
  for (const file of incoming) {
    if (MD_PATTERN.test(file.name)) {
      mdFile = file
    } else {
      images.set(file.name.toLowerCase(), file)
    }
  }
  return mdFile ? [mdFile, ...images.values()] : [...images.values()]
}

export function mountPanel(doc, { platform, run }) {
  const host = doc.createElement('div')
  host.id = 'rin-draftferry'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="capsule">
      <button class="grip" type="button" aria-label="拖动或用方向键移动面板">${GRIP_SVG}</button>
      <span class="sep" aria-hidden="true"></span>
      <button class="toggle" type="button"><span class="dot"></span><span>DraftFerry</span></button>
    </div>
    <section class="card" hidden aria-label="DraftFerry 导入面板">
      <header class="head">
        <div class="head-drag" tabindex="0" aria-label="拖动面板">
          <span style="color:var(--text-muted);display:inline-flex">${GRIP_SVG}</span>
          <span class="brand">DraftFerry</span>
          <span class="badge"><span class="dot"></span><span class="platform-name"></span></span>
        </div>
        <button class="close" type="button" aria-label="关闭面板">×</button>
      </header>
      <div class="body">
        <div class="drop" role="button" tabindex="0">
          <span class="drop-title">拖入 .md 与本地图片，或点击选择</span>
          <span class="drop-sub">支持多次追加，同名图片自动去重</span>
        </div>
        <input type="file" multiple accept=".md,.markdown,image/*" hidden>
        <div class="files" hidden>
          <div class="files-bar">
            <span class="files-summary"></span>
            <button class="clear" type="button">清空</button>
          </div>
          <div class="tags"></div>
        </div>
        <button class="paste-toggle" type="button" aria-expanded="false">
          <span class="chev">▸</span>
          <span>或直接粘贴 Markdown（支持 Cmd/Ctrl+V）</span>
        </button>
        <textarea class="paste-input" hidden placeholder="粘贴 Markdown 正文…"></textarea>
        <div class="status" role="status" hidden></div>
        <div class="actions">
          <button class="diag" type="button" hidden>复制诊断信息</button>
          <button class="go" type="button"></button>
        </div>
        <textarea class="diag-text" readonly hidden></textarea>
      </div>
    </section>`
  doc.body.append(host)

  const $ = selector => root.querySelector(selector)
  const capsule = $('.capsule')
  const grip = $('.grip')
  const toggle = $('.toggle')
  const card = $('.card')
  const headDrag = $('.head-drag')
  const platformNameEl = $('.platform-name')
  const closeBtn = $('.close')
  const drop = $('.drop')
  const fileInput = $('input[type=file]')
  const filesBox = $('.files')
  const filesSummary = $('.files-summary')
  const clearBtn = $('.clear')
  const tagsEl = $('.tags')
  const pasteToggle = $('.paste-toggle')
  const pasteInput = $('.paste-input')
  const statusEl = $('.status')
  const goBtn = $('.go')
  const diagBtn = $('.diag')
  const diagText = $('.diag-text')

  let currentPlatform = platform
  let pendingFiles = []
  let diagnostic = ''
  let hideTimer = null
  let busy = false

  const syncPlatformLabels = () => {
    const name = currentPlatform?.name ?? '当前平台'
    platformNameEl.textContent = name
    if (!busy) goBtn.textContent = `导入到 ${name}`
  }

  const setStatus = (text, kind = '') => {
    statusEl.textContent = text
    statusEl.className = kind ? `status ${kind}` : 'status'
    statusEl.hidden = !text
  }

  const showDiagnostic = (text) => {
    diagnostic = text
    diagBtn.hidden = !text
    if (!text) diagText.hidden = true
  }

  const renderFiles = () => {
    tagsEl.innerHTML = ''
    if (!pendingFiles.length) {
      filesBox.hidden = true
      return
    }
    filesBox.hidden = false
    const mdCount = pendingFiles.filter(f => MD_PATTERN.test(f.name)).length
    const imgCount = pendingFiles.length - mdCount
    const parts = []
    if (mdCount) parts.push(`主稿 ${mdCount}`)
    if (imgCount) parts.push(`图片 ${imgCount}`)
    filesSummary.textContent = parts.join(' · ')
    for (const file of pendingFiles) {
      const tag = doc.createElement('span')
      tag.className = MD_PATTERN.test(file.name) ? 'tag md' : 'tag'
      const nameSpan = doc.createElement('span')
      nameSpan.className = 'tag-name'
      nameSpan.textContent = file.name
      nameSpan.title = file.name
      const del = doc.createElement('button')
      del.type = 'button'
      del.className = 'tag-del'
      del.textContent = '×'
      del.setAttribute('aria-label', `移除 ${file.name}`)
      del.addEventListener('click', () => {
        pendingFiles = pendingFiles.filter(f => f !== file)
        renderFiles()
      })
      tag.append(nameSpan, del)
      tagsEl.append(tag)
    }
  }

  const setPasteOpen = (expanded) => {
    pasteToggle.setAttribute('aria-expanded', String(expanded))
    pasteInput.hidden = !expanded
  }

  const open = () => {
    clearTimeout(hideTimer)
    syncPlatformLabels()
    capsule.hidden = true
    card.hidden = false
  }

  const close = () => {
    clearTimeout(hideTimer)
    card.hidden = true
    capsule.hidden = false
  }

  const addFiles = (files) => {
    const list = [...(files ?? [])]
    if (!list.length) return
    pendingFiles = mergePendingFiles(pendingFiles, list)
    renderFiles()
  }

  const positionController = attachPanelPosition(host, [grip, headDrag])

  toggle.addEventListener('click', open)
  closeBtn.addEventListener('click', close)
  drop.addEventListener('click', () => fileInput.click())
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click() } })
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = '' })
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (e) => {
    e.preventDefault()
    drop.classList.remove('over')
    addFiles(e.dataTransfer?.files)
  })
  clearBtn.addEventListener('click', () => { pendingFiles = []; renderFiles() })
  pasteToggle.addEventListener('click', () => {
    const next = pasteInput.hidden
    setPasteOpen(next)
    if (next) pasteInput.focus()
  })

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && !card.hidden) close()
  }
  const onPointerDownOutside = (event) => {
    if (card.hidden || busy) return
    if (!event.composedPath().includes(host)) close()
  }
  const onPaste = (event) => {
    if (card.hidden) return
    const path = event.composedPath()
    if (!path.includes(host) || path.includes(pasteInput)) return
    const text = event.clipboardData?.getData('text/plain')
    if (!text) return
    event.preventDefault()
    setPasteOpen(true)
    pasteInput.value = text
    pasteInput.focus()
  }

  doc.addEventListener('keydown', onKeyDown)
  doc.addEventListener('pointerdown', onPointerDownOutside)
  doc.addEventListener('paste', onPaste)

  goBtn.addEventListener('click', async () => {
    if (busy) return
    busy = true
    goBtn.disabled = true
    goBtn.textContent = '准备中…'
    showDiagnostic('')
    setStatus('')
    let outcome
    try {
      outcome = await run({
        files: pendingFiles,
        text: pasteInput.value,
        onProgress: (stageText) => { if (busy && stageText) goBtn.textContent = stageText },
      })
    } catch (error) {
      outcome = { kind: 'error', text: error?.message || String(error), diagnostic: '' }
    }
    busy = false
    goBtn.disabled = false
    syncPlatformLabels()
    const hasWarnings = Boolean(outcome.warnings?.length)
    const kind = outcome.kind === 'error' ? 'error' : hasWarnings ? 'warn' : outcome.kind === 'ok' ? 'ok' : ''
    const prefix = kind === 'ok' ? '✓ ' : ''
    setStatus(hasWarnings ? `${prefix}${outcome.text}（${outcome.warnings.join('；')}）` : `${prefix}${outcome.text}`, kind)
    showDiagnostic(outcome.diagnostic ?? '')
    if (outcome.kind === 'ok') {
      pendingFiles = []
      pasteInput.value = ''
      setPasteOpen(false)
      renderFiles()
      if (!hasWarnings) {
        hideTimer = setTimeout(() => { setStatus(''); close() }, 1500)
      }
    }
  })

  diagBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(diagnostic)
      setStatus('✓ 诊断信息已复制到剪贴板', 'ok')
    } catch {
      diagText.hidden = false
      diagText.value = diagnostic
      diagText.select()
      setStatus('浏览器限制了自动复制，请手动复制下方诊断内容', 'warn')
    }
  })

  syncPlatformLabels()

  return {
    host,
    open,
    close,
    setStatus,
    setPlatform(next) {
      currentPlatform = next
      syncPlatformLabels()
    },
    destroy() {
      clearTimeout(hideTimer)
      positionController.destroy()
      doc.removeEventListener('keydown', onKeyDown)
      doc.removeEventListener('pointerdown', onPointerDownOutside)
      doc.removeEventListener('paste', onPaste)
      host.remove()
    },
  }
}
