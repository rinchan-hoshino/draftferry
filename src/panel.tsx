import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { attachPanelPosition } from './position.ts'
import type { PanelOutcome, PanelRunPayload, PlatformAdapter } from './types.ts'

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
.drop-sub { font-size: 11.5px; color: var(--text-muted); }

.files { display: flex; flex-direction: column; gap: 6px; }
.files-bar { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--text-sub); }
.clear { font-size: 11.5px; color: var(--text-muted); }
.clear:hover { color: var(--err-text); }
.tags { display: flex; flex-wrap: wrap; gap: 5px; max-height: 90px; overflow-y: auto; }
.tag {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 2px 7px; border-radius: 6px; background: var(--bg-soft);
  border: 1px solid var(--border); font-size: 11.5px; color: var(--text);
}
.tag.md { border-color: var(--accent); background: var(--accent-soft); }
.tag-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 210px; }
.tag-del { color: var(--text-muted); font-size: 13px; line-height: 1; padding: 0 2px; }
.tag-del:hover { color: var(--err-text); }

.paste-toggle {
  display: inline-flex; align-items: center; gap: 5px; align-self: flex-start;
  font-size: 12px; color: var(--text-sub);
}
.paste-toggle:hover { color: var(--text); }
.chev { display: inline-block; transition: transform .15s ease; }
.paste-toggle[aria-expanded="true"] .chev { transform: rotate(90deg); }
.paste-input {
  width: 100%; min-height: 84px; max-height: 180px; resize: vertical;
  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg-soft); color: var(--text);
  font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.status {
  padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45;
  background: var(--bg-soft); color: var(--text-sub); word-break: break-word;
}
.status.ok { background: var(--ok-bg); color: var(--ok-text); }
.status.warn { background: var(--warn-bg); color: var(--warn-text); }
.status.error { background: var(--err-bg); color: var(--err-text); }

.actions { display: flex; gap: 8px; }
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

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <circle cx="2.5" cy="2.5" r="1.2" />
      <circle cx="7.5" cy="2.5" r="1.2" />
      <circle cx="2.5" cy="7" r="1.2" />
      <circle cx="7.5" cy="7" r="1.2" />
      <circle cx="2.5" cy="11.5" r="1.2" />
      <circle cx="7.5" cy="11.5" r="1.2" />
    </svg>
  )
}

export function mergePendingFiles(existing: File[], incoming: File[]): File[] {
  let mdFile: File | null = existing.find((file) => MD_PATTERN.test(file.name)) ?? null
  const images = new Map<string, File>()
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

interface PanelAppProps {
  host: HTMLElement
  doc: Document
  initialPlatform: PlatformAdapter
  run: (payload: PanelRunPayload) => Promise<PanelOutcome>
  onReady: (api: {
    open: () => void
    close: () => void
    setStatus: (text: string, kind?: '' | 'ok' | 'warn' | 'error') => void
    setPlatform: (next: PlatformAdapter) => void
  }) => void
}

function PanelApp({ host, doc, initialPlatform, run, onReady }: PanelAppProps) {
  const [platform, setPlatform] = useState<PlatformAdapter>(initialPlatform)
  const [isOpen, setIsOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [status, setStatusState] = useState<{ text: string; kind: '' | 'ok' | 'warn' | 'error' }>({
    text: '',
    kind: '',
  })
  const [diagnostic, setDiagnostic] = useState('')
  const [diagVisible, setDiagVisible] = useState(false)

  const gripRef = useRef<HTMLButtonElement>(null)
  const headDragRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pasteInputRef = useRef<HTMLTextAreaElement>(null)
  const diagTextRef = useRef<HTMLTextAreaElement>(null)
  const hideTimerRef = useRef<number | null>(null)
  const isOpenRef = useRef(isOpen)
  const busyRef = useRef(busy)
  isOpenRef.current = isOpen
  busyRef.current = busy

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const open = () => {
    clearHideTimer()
    setIsOpen(true)
  }

  const close = () => {
    clearHideTimer()
    setIsOpen(false)
  }

  const setStatus = (text: string, kind: '' | 'ok' | 'warn' | 'error' = '') => {
    setStatusState({ text, kind })
  }

  useEffect(() => {
    onReady({ open, close, setStatus, setPlatform })
  }, [])

  useEffect(() => {
    const handles = [gripRef.current, headDragRef.current].filter(
      (el): el is HTMLButtonElement | HTMLDivElement => el !== null,
    )
    const positionController = attachPanelPosition(host, handles)
    return () => {
      clearHideTimer()
      positionController.destroy()
    }
  }, [host])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpenRef.current) close()
    }
    const onPointerDownOutside = (event: PointerEvent) => {
      if (!isOpenRef.current || busyRef.current) return
      if (!event.composedPath().includes(host)) close()
    }
    const onPaste = (event: ClipboardEvent) => {
      if (!isOpenRef.current) return
      const path = event.composedPath()
      if (!path.includes(host) || (pasteInputRef.current && path.includes(pasteInputRef.current))) {
        return
      }
      const text = event.clipboardData?.getData('text/plain')
      if (!text) return
      event.preventDefault()
      setPasteOpen(true)
      setPasteText(text)
      queueMicrotask(() => pasteInputRef.current?.focus())
    }

    doc.addEventListener('keydown', onKeyDown)
    doc.addEventListener('pointerdown', onPointerDownOutside)
    doc.addEventListener('paste', onPaste)
    return () => {
      doc.removeEventListener('keydown', onKeyDown)
      doc.removeEventListener('pointerdown', onPointerDownOutside)
      doc.removeEventListener('paste', onPaste)
    }
  }, [doc, host])

  const addFiles = (files: FileList | File[] | null | undefined) => {
    const list = [...(files ?? [])]
    if (!list.length) return
    setPendingFiles((prev) => mergePendingFiles(prev, list))
  }

  const handleImport = async () => {
    if (busy) return
    setBusy(true)
    setProgressText('准备中…')
    setDiagnostic('')
    setDiagVisible(false)
    setStatus('')

    let outcome: PanelOutcome
    try {
      outcome = await run({
        files: pendingFiles,
        text: pasteText,
        onProgress: (stageText) => {
          if (stageText) setProgressText(stageText)
        },
      })
    } catch (error) {
      outcome = {
        kind: 'error',
        text: error instanceof Error ? error.message : String(error),
        diagnostic: '',
      }
    }

    setBusy(false)
    setProgressText('')
    const hasWarnings = Boolean(outcome.warnings?.length)
    const kind =
      outcome.kind === 'error'
        ? 'error'
        : hasWarnings
          ? 'warn'
          : outcome.kind === 'ok'
            ? 'ok'
            : ''
    const prefix = kind === 'ok' ? '✓ ' : ''
    const message = hasWarnings
      ? `${prefix}${outcome.text}（${outcome.warnings!.join('；')}）`
      : `${prefix}${outcome.text}`
    setStatus(message, kind)
    setDiagnostic(outcome.diagnostic ?? '')

    if (outcome.kind === 'ok') {
      setPendingFiles([])
      setPasteText('')
      setPasteOpen(false)
      if (!hasWarnings) {
        hideTimerRef.current = window.setTimeout(() => {
          setStatus('')
          close()
        }, 1500)
      }
    }
  }

  const handleCopyDiag = async () => {
    try {
      await navigator.clipboard.writeText(diagnostic)
      setStatus('✓ 诊断信息已复制到剪贴板', 'ok')
    } catch {
      setDiagVisible(true)
      queueMicrotask(() => diagTextRef.current?.select())
      setStatus('浏览器限制了自动复制，请手动复制下方诊断内容', 'warn')
    }
  }

  const mdCount = pendingFiles.filter((f) => MD_PATTERN.test(f.name)).length
  const imgCount = pendingFiles.length - mdCount
  const summaryParts: string[] = []
  if (mdCount) summaryParts.push(`主稿 ${mdCount}`)
  if (imgCount) summaryParts.push(`图片 ${imgCount}`)

  const platformName = platform?.name ?? '当前平台'

  return (
    <>
      <style>{CSS}</style>
      <div class="capsule" hidden={isOpen}>
        <button
          ref={gripRef}
          class="grip"
          type="button"
          aria-label="拖动或用方向键移动面板"
        >
          <GripIcon />
        </button>
        <span class="sep" aria-hidden="true" />
        <button class="toggle" type="button" onClick={open}>
          <span class="dot" />
          <span>Folio</span>
        </button>
      </div>

      <section class="card" hidden={!isOpen} aria-label="Folio 导入面板">
        <header class="head">
          <div ref={headDragRef} class="head-drag" tabIndex={0} aria-label="拖动面板">
            <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
              <GripIcon />
            </span>
            <span class="brand">Folio</span>
            <span class="badge">
              <span class="dot" />
              <span class="platform-name">{platformName}</span>
            </span>
          </div>
          <button class="close" type="button" aria-label="关闭面板" onClick={close}>
            ×
          </button>
        </header>

        <div class="body">
          <div
            class={dragOver ? 'drop over' : 'drop'}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              addFiles(e.dataTransfer?.files)
            }}
          >
            <span class="drop-title">拖入 .md 与本地图片，或点击选择</span>
            <span class="drop-sub">支持多次追加，同名图片自动去重</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.markdown,image/*"
            hidden
            onChange={(e) => {
              const input = e.currentTarget
              addFiles(input.files)
              input.value = ''
            }}
          />

          <div class="files" hidden={!pendingFiles.length}>
            <div class="files-bar">
              <span class="files-summary">{summaryParts.join(' · ')}</span>
              <button class="clear" type="button" onClick={() => setPendingFiles([])}>
                清空
              </button>
            </div>
            <div class="tags">
              {pendingFiles.map((file) => (
                <span key={file.name} class={MD_PATTERN.test(file.name) ? 'tag md' : 'tag'}>
                  <span class="tag-name" title={file.name}>
                    {file.name}
                  </span>
                  <button
                    type="button"
                    class="tag-del"
                    aria-label={`移除 ${file.name}`}
                    onClick={() =>
                      setPendingFiles((prev) => prev.filter((item) => item !== file))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <button
            class="paste-toggle"
            type="button"
            aria-expanded={pasteOpen}
            onClick={() => {
              const next = !pasteOpen
              setPasteOpen(next)
              if (next) queueMicrotask(() => pasteInputRef.current?.focus())
            }}
          >
            <span class="chev">▸</span>
            <span>或直接粘贴 Markdown（支持 Cmd/Ctrl+V）</span>
          </button>

          <textarea
            ref={pasteInputRef}
            class="paste-input"
            hidden={!pasteOpen}
            placeholder="粘贴 Markdown 正文…"
            value={pasteText}
            onInput={(e) => setPasteText(e.currentTarget.value)}
          />

          <div
            class={status.kind ? `status ${status.kind}` : 'status'}
            role="status"
            hidden={!status.text}
          >
            {status.text}
          </div>

          <div class="actions">
            <button
              class="diag"
              type="button"
              hidden={!diagnostic}
              onClick={handleCopyDiag}
            >
              复制诊断信息
            </button>
            <button class="go" type="button" disabled={busy} onClick={handleImport}>
              {busy ? progressText || '准备中…' : `导入到 ${platformName}`}
            </button>
          </div>

          <textarea
            ref={diagTextRef}
            class="diag-text"
            readOnly
            hidden={!diagVisible}
            value={diagnostic}
          />
        </div>
      </section>
    </>
  )
}

export interface MountedPanel {
  host: HTMLElement
  open: () => void
  close: () => void
  setStatus: (text: string, kind?: '' | 'ok' | 'warn' | 'error') => void
  setPlatform: (next: PlatformAdapter) => void
  destroy: () => void
}

export function mountPanel(
  doc: Document,
  {
    platform,
    run,
  }: {
    platform: PlatformAdapter
    run: (payload: PanelRunPayload) => Promise<PanelOutcome>
  },
): MountedPanel {
  const host = doc.createElement('div')
  host.id = 'rin-folio'
  const root = host.attachShadow({ mode: 'open' })
  doc.body.append(host)

  let api: {
    open: () => void
    close: () => void
    setStatus: (text: string, kind?: '' | 'ok' | 'warn' | 'error') => void
    setPlatform: (next: PlatformAdapter) => void
  } | null = null

  render(
    <PanelApp
      host={host}
      doc={doc}
      initialPlatform={platform}
      run={run}
      onReady={(readyApi) => {
        api = readyApi
      }}
    />,
    root,
  )

  return {
    host,
    open: () => api?.open(),
    close: () => api?.close(),
    setStatus: (text, kind) => api?.setStatus(text, kind),
    setPlatform: (next) => api?.setPlatform(next),
    destroy() {
      render(null, root)
      host.remove()
    },
  }
}
