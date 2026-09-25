const PANEL_ID = 'rin-draftferry-panel'

const styles = `
  :host { all: initial; color-scheme: light; }
  *, *::before, *::after { box-sizing: border-box; }
  .panel {
    display: grid; justify-items: end; gap: 10px;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #27272a; pointer-events: none;
  }
  button, summary { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  button { appearance: none; margin: 0; border: 0; }
  button:focus-visible, summary:focus-visible { outline: 3px solid #a1a1aa; outline-offset: 3px; }
  button:disabled { cursor: wait; opacity: .55; }
  [hidden] { display: none !important; }
  .toolbar {
    display: flex; align-items: center; padding: 4px; gap: 2px; pointer-events: auto;
    border: 1px solid #e4e4e7; border-radius: 14px; background: #fff;
    box-shadow: 0 3px 12px #18181b12, 0 1px 3px #18181b0a;
  }
  .import { min-height: 38px; padding: 8px 13px; border-radius: 10px; background: #27272a; color: #fff; font-weight: 600; white-space: nowrap; }
  .import:hover:not(:disabled) { background: #3f3f46; }
  details { position: relative; }
  summary { display: grid; place-items: center; width: 34px; min-height: 38px; border-radius: 9px; list-style: none; font-size: 22px; color: #71717a; user-select: none; }
  summary::-webkit-details-marker { display: none; }
  summary:hover, details[open] summary { background: #f4f4f5; color: #27272a; }
  .menu { position: absolute; right: 0; bottom: calc(100% + 12px); min-width: 160px; padding: 5px; border: 1px solid #e4e4e7; border-radius: 12px; background: #fff; box-shadow: 0 6px 24px #18181b16; }
  .menu button { display: block; width: 100%; min-height: 38px; padding: 8px 12px; border-radius: 7px; text-align: left; background: transparent; color: #3f3f46; white-space: nowrap; }
  .menu button:hover:not(:disabled) { background: #f4f4f5; }
  .feedback { position: relative; width: min(320px, calc(100vw - 32px)); padding: 14px 38px 14px 15px; border: 1px solid #e4e4e7; border-radius: 14px; background: #fff; box-shadow: 0 6px 24px #18181b12; pointer-events: auto; overflow-wrap: anywhere; }
  .feedback strong { display: block; margin: 0 0 4px; font-size: 13px; font-weight: 650; }
  .message { margin: 0; font-size: 13px; line-height: 1.6; color: #71717a; }
  .feedback[data-state="error"] strong { color: #b42318; }
  .dismiss { position: absolute; top: 7px; right: 6px; width: 28px; height: 28px; border-radius: 7px; background: transparent; color: #a1a1aa; font-size: 20px; line-height: 1; }
  .dismiss:hover { background: #f4f4f5; color: #52525b; }
  @media (prefers-contrast: more) { .toolbar, .feedback, .menu { border-color: #71717a; } .message { color: #3f3f46; } }
  @media (forced-colors: active) { .toolbar, .feedback, .menu { border: 1px solid CanvasText; } button { border: 1px solid ButtonText; } }
`

/** The panel owns presentation and its listeners, not the import operation. */
export function createPanel(document, platformName) {
  const host = document.createElement('section')
  host.id = PANEL_ID
  host.setAttribute('aria-label', `稿渡 · ${platformName}`)
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${styles}</style>
    <div class="panel">
      <div class="feedback" hidden>
        <strong data-heading>稿渡</strong>
        <p class="message" data-rin-status role="status" aria-live="polite" aria-atomic="true"></p>
        <button class="dismiss" type="button" aria-label="收起提示" title="收起提示">×</button>
      </div>
      <div class="toolbar" aria-label="稿渡">
        <button class="import" type="button" data-rin-action="import">导入 Markdown</button>
        <details>
          <summary aria-label="更多操作" title="更多操作">⋯</summary>
          <div class="menu">
            <button type="button" data-rin-action="diagnose">下载诊断</button>
          </div>
        </details>
      </div>
      <input data-rin-files type="file" accept=".md,.markdown,image/*" multiple hidden style="display:none !important">
    </div>
  `

  const button = root.querySelector('[data-rin-action="import"]')
  const diagnoseButton = root.querySelector('[data-rin-action="diagnose"]')
  const fileInput = root.querySelector('[data-rin-files]')
  const feedback = root.querySelector('.feedback')
  const heading = root.querySelector('[data-heading]')
  const status = root.querySelector('[data-rin-status]')
  const dismiss = root.querySelector('.dismiss')
  const menu = root.querySelector('details')
  const summary = root.querySelector('summary')

  const closeMenu = (event) => {
    if (!event.composedPath().includes(host)) menu.open = false
  }
  menu.addEventListener('toggle', () => {
    document.removeEventListener('pointerdown', closeMenu, true)
    if (menu.open) document.addEventListener('pointerdown', closeMenu, true)
  })
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false
      summary.focus({ preventScroll: true })
    }
  })
  diagnoseButton.addEventListener('click', () => { menu.open = false })
  dismiss.addEventListener('click', () => { feedback.hidden = true })

  return {
    host,
    button,
    diagnoseButton,
    fileInput,
    setStatus(message, state = 'idle') {
      const busy = state === 'busy'
      status.textContent = message
      heading.textContent = busy ? '正在处理' : state === 'error' ? '暂未完成' : '稿渡'
      feedback.dataset.state = state
      feedback.hidden = !message
      dismiss.hidden = busy
      button.disabled = busy
      diagnoseButton.disabled = busy
      button.setAttribute('aria-busy', String(busy))
    },
    destroy() {
      document.removeEventListener('pointerdown', closeMenu, true)
      menu.open = false
      host.remove()
    },
  }
}

export { PANEL_ID }
