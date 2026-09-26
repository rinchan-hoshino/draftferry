import { BUSY_PHASES } from './import-task.js'

export const PANEL_ID = 'rin-draftferry-panel'

const styles = `
:host { all:initial; color-scheme:light dark; --paper:light-dark(#fff,#242624); --ink:light-dark(#262a26,#f0f2ed); --secondary:light-dark(#686f67,#b1b7ad); --line:light-dark(#e5e8e2,#3b403a); --soft:light-dark(#f5f6f2,#2c302b); --inverse:light-dark(#fff,#222620); --warning:light-dark(#906522,#e9bc74); font:14px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif; color:var(--ink); }
*{box-sizing:border-box} [hidden]{display:none!important} button,summary{font:inherit;color:inherit;cursor:pointer}button{border:0}button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.panel{pointer-events:auto;display:flex;flex-direction:column;align-items:flex-end;gap:10px;max-width:calc(100vw - 32px);color-scheme:light dark;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}
.workbench{width:364px;max-width:100%;max-height:calc(100dvh - 88px);overflow:auto;overscroll-behavior:contain;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 36px #20281d18}
.header{display:flex;align-items:center;gap:8px;padding:13px 18px;border-bottom:1px solid var(--line)}.brand{letter-spacing:.08em;font-weight:500}.brand-mark{display:grid;place-items:center;width:25px;height:25px;border-radius:6px;background:var(--ink);color:var(--inverse);font-size:17px}.caption{font-size:12px;color:var(--secondary)}.header-actions{margin-left:auto;display:flex;gap:3px;align-items:center}.icon-button,summary{display:grid;place-items:center;width:30px;height:30px;border-radius:5px;background:transparent;padding:0;list-style:none}.icon-button:hover,summary:hover{background:var(--soft)}summary::-webkit-details-marker{display:none}
.document{padding:22px 22px 18px}.kicker{font-size:11px;letter-spacing:.13em;color:var(--secondary)}h2{font-family:'Songti SC','Noto Serif CJK SC',serif;font-size:25px;font-weight:500;line-height:1.45;letter-spacing:-.02em;margin:8px 0 7px;overflow-wrap:anywhere}.filename{font-size:12px;color:var(--secondary);overflow-wrap:anywhere}.destination{font-size:12px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:7px}.destination-label{color:var(--secondary)}
.status{padding:0 22px 18px}.state-title{font-size:15px;font-weight:500;margin:0 0 6px}.message{color:var(--secondary);font-size:12px;line-height:1.7;margin:0;overflow-wrap:anywhere}.workbench[data-state=missing] .state-title,.workbench[data-state=failed] .state-title{color:var(--warning)}
.assets{list-style:none;margin:14px 0 0;padding:0}.asset{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--line);font-size:12px}.asset-name{flex:1;min-width:0;overflow-wrap:anywhere}.asset-state{flex-shrink:0;color:var(--secondary);font-size:11px}.asset[data-state=missing] .asset-state,.asset[data-state=failed] .asset-state{color:var(--warning)}
progress{display:block;width:100%;height:3px;border:0;border-radius:2px;overflow:hidden;margin:16px 0 8px;accent-color:var(--ink)}progress::-webkit-progress-bar{background:var(--line)}progress::-webkit-progress-value{background:var(--ink)}.progress-label{font-size:11px;color:var(--secondary)}
.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;background:var(--soft);border-top:1px solid var(--line)}.primary{background:var(--ink);color:var(--inverse);font-size:12px;min-height:36px;padding:8px 14px;border-radius:6px}.secondary{font-size:12px;color:var(--secondary);background:transparent;padding:7px 0}.primary:hover{opacity:.88}.secondary:hover{color:var(--ink)}
.toolbar{display:flex;align-items:center;gap:4px;padding:5px 7px;background:var(--paper);border:1px solid var(--line);border-radius:8px;box-shadow:0 5px 16px #20281d12}.import{padding:5px 8px;background:transparent;min-height:30px;font-size:12px;max-width:calc(100vw - 95px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.import[data-attention=true]::before{content:'●';font-size:8px;color:var(--warning);margin-right:7px}
details{position:relative}.menu{position:absolute;right:0;top:36px;width:156px;padding:6px;background:var(--paper);border:1px solid var(--line);border-radius:7px;box-shadow:0 5px 16px #20281d18;z-index:2}.toolbar .menu{top:auto;bottom:36px}.menu button{display:block;width:100%;background:transparent;text-align:left;padding:9px 10px;font-size:12px;border-radius:4px}.menu button:hover{background:var(--soft)}
@media(pointer:coarse){button,summary{min-height:44px}.icon-button,summary{width:44px}.menu{top:48px}.toolbar .menu{bottom:48px}}
@media(max-width:380px){.document{padding:18px}.status{padding:0 18px 16px}.actions{padding:14px 18px}h2{font-size:23px}}
`

const phaseTitles = { reading: '正在读取稿件', preparing: '准备正文与图片', importing: '正在填入编辑器', missing: '补齐图片，接着导入', failed: '这篇稿件尚未完成', paused: '导入已暂停', pausing: '正在暂停导入', invalid: '请选择一篇稿件', notice: '稿渡' }
const assetLabels = { pending: '等待处理', preparing: '正在准备', ready: '已准备', missing: '待补选', failed: '未完成', uploading: '正在上传', uploaded: '已上传' }

export function createPanel(document, platformName, onAction = () => {}) {
  const host = document.createElement('div')
  host.id = PANEL_ID
  host.setAttribute('aria-label', `稿渡 · ${platformName}`)
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${styles}</style><div class="panel">
    <section class="workbench feedback" aria-label="当前稿件" hidden>
      <header class="header"><span class="brand-mark" aria-hidden="true">↥</span><span class="brand">稿渡</span><span class="caption">当前稿件</span><div class="header-actions"><button class="icon-button dismiss" type="button" data-action="collapse" aria-label="收起稿件">−</button></div></header>
      <div class="document"><div class="kicker">正在渡送的稿件</div><h2></h2><div class="filename"></div><div class="destination"><span class="destination-label">送往</span><span data-destination></span></div></div>
      <div class="status"><p class="state-title"></p><p class="message" data-rin-status role="status" aria-live="polite" aria-atomic="true"></p><ul class="assets"></ul><div class="progress-group" hidden><progress max="1" value="0" aria-label="素材准备进度"></progress><div class="progress-label"></div></div></div>
      <footer class="actions"><button type="button" class="secondary" data-secondary></button><button type="button" class="primary" data-primary></button></footer>
    </section>
    <div class="toolbar"><button class="import" type="button" data-rin-action="import">导入 Markdown</button><details><summary aria-label="更多操作">⋯</summary><div class="menu"><button type="button" data-action="new">导入另一篇</button><button type="button" data-rin-action="diagnose">下载诊断</button></div></details></div>
    <input data-rin-files type="file" accept=".md,.markdown,image/*" multiple hidden style="display:none !important">
  </div>`
  const query = selector => root.querySelector(selector)
  const workbench = query('.workbench')
  const toolbar = query('.toolbar')
  const button = query('.import')
  const fileInput = query('[data-rin-files]')
  const menu = query('details')
  const diagnoseButton = query('[data-rin-action="diagnose"]')
  let state = { phase: 'idle', assets: [] }
  let collapsed = true
  let destroyed = false
  let fileMode = 'new'
  const collapse = () => { collapsed = true; render() }
  const closeMenu = event => { if (!event.composedPath().includes(host)) menu.open = false }
  menu.addEventListener('toggle', () => {
    document.removeEventListener('pointerdown', closeMenu, true)
    if (menu.open && !destroyed) document.addEventListener('pointerdown', closeMenu, true)
  })
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (menu.open) { menu.open = false; query('summary').focus({ preventScroll: true }) }
    else if (!collapsed) { collapse(); button.focus({ preventScroll: true }) }
  })
  root.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.action
    if (!action) return
    if (action === 'collapse') collapse()
    else { menu.open = false; onAction(action) }
  })
  button.addEventListener('click', () => {
    if (state.phase === 'idle') onAction('new')
    else { collapsed = false; render() }
  })
  diagnoseButton.addEventListener('click', () => { menu.open = false; onAction('diagnose') })
  function render() {
    const busy = BUSY_PHASES.has(state.phase)
    diagnoseButton.disabled = busy
    workbench.hidden = collapsed || state.phase === 'idle'
    workbench.dataset.state = state.phase
    toolbar.hidden = !workbench.hidden
    const actions = workbench.hidden ? toolbar : query('.header-actions')
    if (menu.parentElement !== actions) { menu.open = false; actions.append(menu) }
    query('h2').textContent = state.title || state.filename || '准备稿件'
    query('.filename').textContent = state.filename || 'Markdown 与本地图片'
    query('[data-destination]').textContent = state.destination || platformName
    query('.state-title').textContent = state.phase === 'done' ? state.message : phaseTitles[state.phase] || '稿渡'
    query('[data-rin-status]').textContent = state.phase === 'done'
      ? `${[state.summary?.imageCount && `${state.summary.imageCount} 张图片`, state.summary?.tableCount && `${state.summary.tableCount} 个表格`, state.summary?.codeCount && `${state.summary.codeCount} 段代码`].filter(Boolean).join(' · ') || '正文已就位'}。请在平台检查后手动保存。`
      : state.phase === 'missing' ? '补选下方图片后会自动继续，无需重选稿件。' : state.message || ''
    const list = query('.assets')
    list.replaceChildren()
    for (const asset of state.assets.filter(asset => ['missing', 'failed', 'preparing', 'uploading'].includes(asset.status))) {
      const row = document.createElement('li')
      row.className = 'asset'
      row.dataset.state = asset.status
      const name = document.createElement('span')
      name.className = 'asset-name'
      name.textContent = asset.name
      const label = document.createElement('span')
      label.className = 'asset-state'
      label.textContent = assetLabels[asset.status]
      row.append(name, label)
      list.append(row)
    }
    const done = state.assets.filter(asset => ['ready', 'uploaded'].includes(asset.status)).length
    query('.progress-group').hidden = state.phase !== 'preparing' || !state.assets.length
    query('progress').max = Math.max(1, state.assets.length)
    query('progress').value = done
    query('.progress-label').textContent = `素材准备 ${done} / ${state.assets.length}`
    query('.caption').textContent = busy ? '正在导入' : state.phase === 'done' ? '已完成' : '当前稿件'
    query('.kicker').textContent = state.phase === 'done' ? '这一篇，已就位' : '正在渡送的稿件'
    const primary = query('[data-primary]')
    const secondary = query('[data-secondary]')
    const primaryAction = busy ? ['collapse', '收起'] : state.phase === 'missing' ? ['supplement', '补选图片'] : state.phase === 'done' ? ['reveal', '查看正文'] : ['failed', 'paused'].includes(state.phase) && state.canResume !== false ? ['resume', state.phase === 'paused' ? '继续导入' : state.retryLabel || '重试未完成项'] : state.phase === 'notice' ? ['collapse', '完成'] : ['new', '重新选择']
    primary.dataset.action = primaryAction[0]
    primary.textContent = primaryAction[1]
    secondary.disabled = state.phase === 'pausing'
    secondary.dataset.action = busy ? 'pause' : 'collapse'
    secondary.textContent = busy ? '暂停导入' : state.phase === 'done' ? '完成' : '稍后处理'
    query('[data-action="new"]').disabled = busy
    button.textContent = state.phase === 'idle' ? '导入 Markdown' : `稿渡 · ${busy ? '正在导入' : state.phase === 'done' ? '已完成' : state.phase === 'missing' ? '需要补图' : '查看稿件'}`
    button.dataset.attention = String(['missing', 'failed'].includes(state.phase))
    button.setAttribute('aria-expanded', String(!workbench.hidden))
  }
  return {
    host, button, fileInput, diagnoseButton,
    get fileMode() { return fileMode },
    chooseFiles(mode = 'new') {
      fileMode = mode
      fileInput.value = ''
      fileInput.accept = mode === 'supplement' ? 'image/*' : '.md,.markdown,image/*'
      fileInput.click()
    },
    setState(next) {
      if (next.phase === 'reading' && state.phase !== 'reading' || next.phase === 'invalid') collapsed = false
      state = next
      render()
    },
    setStatus(message, status = 'idle') {
      collapsed = false
      state = { ...state, phase: status === 'error' ? 'failed' : status === 'busy' ? 'preparing' : 'notice', message }
      render()
    },
    collapse,
    destroy() { destroyed = true; document.removeEventListener('pointerdown', closeMenu, true); menu.open = false; host.remove() },
  }
}
