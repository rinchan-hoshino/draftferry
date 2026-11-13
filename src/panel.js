const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
.fab { position: fixed; right: 24px; bottom: 24px; z-index: 2147483000; border: 0; border-radius: 999px;
  padding: 10px 18px; background: #e8833a; color: #fff; font-size: 14px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
.panel { position: fixed; right: 24px; bottom: 76px; z-index: 2147483000; width: 340px; padding: 14px;
  background: #fff; color: #222; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.22); font-size: 13px; }
.panel[hidden] { display: none; }
.drop { border: 2px dashed #e8833a; border-radius: 10px; padding: 22px 12px; text-align: center; cursor: pointer; color: #8a5a2b; line-height: 1.5; }
.drop.over { background: #fff4e8; }
textarea { width: 100%; height: 64px; margin-top: 10px; padding: 6px 8px; border: 1px solid #ddd; border-radius: 8px; resize: vertical; font-size: 12px; }
.row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
button.go, button.diag { border: 0; border-radius: 8px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
button.go { background: #e8833a; color: #fff; }
button.go:disabled { opacity: .5; cursor: default; }
button.diag { background: #f1ece6; color: #5a4632; }
button.diag[hidden] { display: none; }
.status { margin: 10px 0 0; min-height: 1.2em; line-height: 1.5; word-break: break-all; }
.status.ok { color: #2e7d32; }
.status.warn { color: #b26a00; }
.status.error { color: #c62828; }
.diag-text { width: 100%; height: 90px; margin-top: 8px; font-size: 11px; font-family: ui-monospace, monospace; }
.diag-text[hidden] { display: none; }
`

export function mountPanel(doc, { run }) {
  const host = doc.createElement('div')
  host.id = 'rin-draftferry'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${CSS}</style>
    <button class="fab" type="button">导入 Markdown</button>
    <section class="panel" hidden>
      <div class="drop">把 .md 和里面用到的图片一起拖进来，或点这里选</div>
      <input type="file" multiple accept=".md,.markdown,image/*" hidden>
      <textarea placeholder="或者直接把 Markdown 粘贴到这里"></textarea>
      <div class="row">
        <button class="diag" type="button" hidden>复制诊断</button>
        <button class="go" type="button">导入</button>
      </div>
      <p class="status" role="status"></p>
      <textarea class="diag-text" hidden></textarea>
    </section>`
  doc.body.append(host)

  const $ = selector => root.querySelector(selector)
  const fab = $('.fab')
  const panel = $('.panel')
  const drop = $('.drop')
  const fileInput = $('input[type=file]')
  const textarea = $('section textarea')
  const go = $('.go')
  const diagButton = $('.diag')
  const status = $('.status')
  const diagText = $('.diag-text')
  let pendingFiles = []
  let diagnostic = ''
  let hideTimer = null

  const setStatus = (text, kind = '') => {
    status.textContent = text
    status.className = `status ${kind}`
  }
  const showDiagnostic = (text) => {
    diagnostic = text
    diagButton.hidden = !text
  }
  const open = () => {
    clearTimeout(hideTimer)
    panel.hidden = false
  }
  const close = () => { panel.hidden = true }
  const refreshDrop = () => {
    drop.textContent = pendingFiles.length
      ? `已选 ${pendingFiles.length} 个：${pendingFiles.map(file => file.name).join('、')}`
      : '把 .md 和里面用到的图片一起拖进来，或点这里选'
  }
  const addFiles = (files) => {
    pendingFiles = [...files]
    refreshDrop()
  }

  fab.addEventListener('click', () => { panel.hidden ? open() : close() })
  drop.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = '' })
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (event) => {
    event.preventDefault()
    drop.classList.remove('over')
    addFiles(event.dataTransfer?.files ?? [])
  })

  go.addEventListener('click', async () => {
    go.disabled = true
    diagText.hidden = true
    showDiagnostic('')
    setStatus('导入中…')
    let outcome
    try {
      outcome = await run({ files: pendingFiles, text: textarea.value })
    } catch (error) {
      outcome = { kind: 'error', text: error?.message || String(error), diagnostic: '' }
    }
    go.disabled = false
    const hasWarnings = Boolean(outcome.warnings?.length)
    const kind = outcome.kind === 'error' ? 'error' : hasWarnings ? 'warn' : outcome.kind === 'ok' ? 'ok' : ''
    setStatus(hasWarnings ? `${outcome.text}（${outcome.warnings.join('；')}）` : outcome.text, kind)
    showDiagnostic(outcome.diagnostic ?? '')
    if (outcome.kind === 'ok') {
      pendingFiles = []
      textarea.value = ''
      refreshDrop()
      if (!hasWarnings) hideTimer = setTimeout(close, 2000)
    }
  })

  diagButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(diagnostic)
      setStatus('诊断已复制', 'ok')
    } catch {
      diagText.hidden = false
      diagText.value = diagnostic
      diagText.select()
      setStatus('浏览器不让直接复制，诊断已放在下面，请手动复制', 'warn')
    }
  })

  return { host, open, close, setStatus }
}
