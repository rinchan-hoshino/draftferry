import { localize, localeFor } from './i18n.js'
import { BUSY_PHASES } from './import-task.js'
import { attachPanelPosition } from './panel-position.js'

export const PANEL_ID = 'rin-draftferry-panel'

const styles = `
:host{all:initial;color-scheme:light dark;--paper:light-dark(#fff,#2c2c2e);--ink:light-dark(#1d1d1f,#f5f5f7);--secondary:light-dark(#666,#b1b1b7);--line:light-dark(#d2d2d7,#48484a);--soft:light-dark(#f5f5f7,#3a3a3c);--primary:#0071e3;--warning:light-dark(#9a6200,#ffb340);font:13px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:var(--ink)}
*{box-sizing:border-box}[hidden]{display:none!important}button,summary{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent}button:disabled{opacity:.4;cursor:default}button:focus-visible,summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.panel{pointer-events:auto;display:flex;flex-direction:column;align-items:flex-end;max-width:calc(100vw - 32px)}
.workbench{display:flex;flex-direction:column;width:280px;max-width:100%;max-height:calc(100dvh - 32px);background:var(--paper);border:1px solid var(--line);border-radius:20px;box-shadow:0 8px 24px #00000026}
.header{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--line);flex-shrink:0}.brand{font-weight:600}.brand-mark{color:var(--primary);font-size:19px}.caption{font-size:11px;color:var(--secondary)}.header-actions{margin-left:auto;display:flex;gap:2px}.icon-button,summary{display:grid;place-items:center;width:28px;height:28px;padding:0;border-radius:6px;list-style:none}.icon-button:hover,summary:hover{background:var(--soft)}summary::-webkit-details-marker{display:none}
.content{min-height:0;overflow:auto;overscroll-behavior:contain}.document{padding:16px 16px 12px}.kicker{font-size:10px;color:var(--secondary)}h2{margin:4px 0;font-size:16px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}.filename{font-size:11px;color:var(--secondary);overflow-wrap:anywhere}.destination{display:flex;flex-wrap:wrap;gap:5px;font-size:11px;margin-top:10px}.destination-label{color:var(--secondary)}
.status{padding:0 16px 16px}.state-title{font-size:13px;font-weight:600;margin:0 0 5px}.message{font-size:12px;color:var(--secondary);line-height:1.6;margin:0;overflow-wrap:anywhere}.workbench[data-state=missing] .state-title{color:var(--warning)}.workbench[data-state=failed] .state-title{color:light-dark(#bc261f,#ff6961)}
.assets{list-style:none;margin:12px 0 0;padding:0}.asset{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line);font-size:11px}.asset-name{flex:1;min-width:0;overflow-wrap:anywhere}.asset-state{color:var(--secondary);flex-shrink:0}.asset[data-state=missing] .asset-state,.asset[data-state=failed] .asset-state{color:var(--warning)}
progress{display:block;width:100%;height:4px;border:0;border-radius:2px;overflow:hidden;margin:12px 0 6px;accent-color:var(--primary)}progress::-webkit-progress-bar{background:var(--soft)}progress::-webkit-progress-value{background:var(--primary)}.progress-label{font-size:11px;color:var(--secondary)}
.actions{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 16px;border-top:1px solid var(--line);flex-shrink:0}.primary{background:var(--primary);color:#fff;min-height:32px;padding:6px 10px;border-radius:6px;font-size:12px}.secondary{font-size:12px;color:var(--secondary);padding:6px 0}.primary:hover{background:#0077ed}.secondary:hover{color:var(--ink)}
.toolbar{display:flex;align-items:center;gap:6px;padding:6px 12px;min-width:160px;max-width:100%;background:var(--paper);border:1px solid var(--line);border-radius:24px;box-shadow:0 8px 24px #00000026}.import{font-size:13px;min-width:0;max-width:calc(100vw - 150px);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.import[data-attention=true]::before{content:'●';font-size:8px;color:var(--warning);margin-right:6px}.drag-handle{touch-action:none;user-select:none;cursor:grab;color:var(--secondary)}.drag-handle.dragging{cursor:grabbing}
details{position:relative}.menu{position:absolute;right:0;top:calc(100% + 4px);width:180px;padding:6px;background:var(--paper);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px #00000026;z-index:2}details[data-above=true] .menu{top:auto;bottom:calc(100% + 4px)}details[data-left=true] .menu{left:0;right:auto}.menu button{display:block;width:100%;text-align:left;padding:8px 10px;font-size:12px;border-radius:4px}.menu button:hover{background:var(--soft)}
@media(pointer:coarse){button,summary{min-height:44px}.icon-button,summary{width:44px}.toolbar{padding:4px 8px}}
`

const phaseTitles = { reading: '正在读取稿件', preparing: '准备正文与图片', importing: '正在填入编辑器', missing: '补齐图片，接着导入', failed: '这篇稿件尚未完成', paused: '导入已暂停', pausing: '正在暂停导入', invalid: '请选择一篇稿件', notice: '稿渡' }
const assetLabels = { pending: '等待处理', preparing: '正在准备', ready: '已准备', missing: '待补选', failed: '未完成', uploading: '正在上传', uploaded: '已上传' }

export function createPanel(document, platformName, onAction = () => {}) {
  const copy = value => localize(value, localeFor(document))
  const host = document.createElement('div')
  host.id = PANEL_ID
  host.setAttribute('aria-label', copy(`稿渡 · ${platformName}`))
  host.style.cssText = 'position:fixed;right:16px;top:50%;transform:translateY(-50%);width:max-content;max-width:calc(100vw - 32px);z-index:2147483647;pointer-events:none;'
  const root = host.attachShadow({ mode: 'open' })
  const dragHandle = '<button class="icon-button drag-handle" type="button" aria-label="移动稿渡" title="拖动调整位置，方向键微调">⠿</button>'
  root.innerHTML = `<style>${styles}</style><div class="panel">
    <section class="workbench feedback" aria-label="当前稿件" hidden>
      <header class="header"><span class="brand-mark" aria-hidden="true">↥</span><span class="brand">稿渡</span><span class="caption">当前稿件</span><div class="header-actions">${dragHandle}<button class="icon-button dismiss" type="button" data-action="collapse" aria-label="收起稿件">−</button></div></header>
      <div class="content"><div class="document"><div class="kicker">正在渡送的稿件</div><h2></h2><div class="filename"></div><div class="destination"><span class="destination-label">送往</span><span data-destination></span></div></div>
      <div class="status"><p class="state-title"></p><p class="message" data-rin-status role="status" aria-live="polite" aria-atomic="true"></p><ul class="assets"></ul><div class="progress-group" hidden><progress max="1" value="0" aria-label="素材准备进度"></progress><div class="progress-label"></div></div></div>
      </div><footer class="actions"><button type="button" class="secondary" data-secondary></button><button type="button" class="primary" data-primary></button></footer>
    </section>
    <div class="toolbar">${dragHandle}<button class="import" type="button" data-rin-action="import">导入 Markdown</button><details><summary aria-label="更多操作">⋯</summary><div class="menu"><button type="button" data-action="new">导入另一篇</button><button type="button" data-action="reset-position">恢复默认位置</button><button type="button" data-rin-action="diagnose">下载诊断</button></div></details></div>
    <input data-rin-files type="file" accept=".md,.markdown,image/*" multiple hidden style="display:none !important">
  </div>`
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of ['aria-label', 'title']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, copy(element.getAttribute(attribute)))
    }
    if (!element.children.length && element.tagName !== 'STYLE') element.textContent = copy(element.textContent)
  }
  const query = selector => root.querySelector(selector)
  const workbench = query('.workbench')
  const toolbar = query('.toolbar')
  const button = query('.import')
  const fileInput = query('[data-rin-files]')
  const menu = query('details')
  const diagnoseButton = query('[data-rin-action="diagnose"]')
  const position = attachPanelPosition(host, root.querySelectorAll('.drag-handle'), () => { menu.open = false })
  let state = { phase: 'idle', assets: [] }
  let collapsed = true
  let destroyed = false
  let fileMode = 'new'
  const collapse = () => { collapsed = true; render() }
  const closeMenu = event => { if (!event.composedPath().includes(host)) menu.open = false }
  menu.addEventListener('toggle', () => {
    document.removeEventListener('pointerdown', closeMenu, true)
    if (menu.open && !destroyed) {
      const rect = query('summary').getBoundingClientRect()
      const height = query('.menu').offsetHeight
      menu.dataset.above = String(workbench.hidden && rect.bottom + height + 20 > document.defaultView.innerHeight)
      menu.dataset.left = String(rect.right < 172)
      document.addEventListener('pointerdown', closeMenu, true)
    }
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
    else if (action === 'reset-position') { menu.open = false; position.reset() }
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
    query('h2').textContent = state.title || state.filename || copy('准备稿件')
    query('.filename').textContent = state.filename || copy('Markdown 与本地图片')
    query('[data-destination]').textContent = (state.destination || platformName).split(' → ').map(copy).join(' → ')
    query('.state-title').textContent = copy(phaseTitles[state.phase] || '稿渡')
    query('[data-rin-status]').textContent = copy(state.phase === 'missing' ? '补选下方图片后会自动继续，无需重选稿件。' : state.message || '')
    const list = query('.assets')
    list.replaceChildren()
    for (const asset of state.assets.filter(asset => ['missing', 'failed', 'preparing', 'uploading'].includes(asset.status))) {
      const row = document.createElement('li')
      row.className = 'asset'
      row.dataset.state = asset.status
      const name = document.createElement('span')
      name.className = 'asset-name'
      name.textContent = asset.kind === 'mermaid' ? copy(asset.name) : asset.name
      const label = document.createElement('span')
      label.className = 'asset-state'
      label.textContent = copy(assetLabels[asset.status])
      row.append(name, label)
      list.append(row)
    }
    const done = state.assets.filter(asset => ['ready', 'uploaded'].includes(asset.status)).length
    query('.progress-group').hidden = state.phase !== 'preparing' || !state.assets.length
    query('progress').max = Math.max(1, state.assets.length)
    query('progress').value = done
    query('.progress-label').textContent = copy(`素材准备 ${done} / ${state.assets.length}`)
    query('.caption').textContent = copy(busy ? '正在导入' : '当前稿件')
    const primary = query('[data-primary]')
    const secondary = query('[data-secondary]')
    const primaryAction = busy ? ['collapse', '收起'] : state.phase === 'missing' ? ['supplement', '补选图片'] : ['failed', 'paused'].includes(state.phase) && state.canResume !== false ? ['resume', state.phase === 'paused' ? '继续导入' : state.retryLabel || '重试未完成项'] : state.phase === 'notice' ? ['collapse', '收起'] : ['new', '重新选择']
    primary.dataset.action = primaryAction[0]
    primary.textContent = copy(primaryAction[1])
    secondary.disabled = state.phase === 'pausing'
    secondary.dataset.action = busy ? 'pause' : 'collapse'
    secondary.textContent = copy(busy ? '暂停导入' : '稍后处理')
    query('.menu [data-action="new"]').disabled = busy
    button.textContent = state.phase === 'idle' ? copy('导入 Markdown') : `${copy('稿渡')} · ${copy(busy ? '正在导入' : state.phase === 'missing' ? '需要补图' : '查看稿件')}`
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
      if (next.phase === 'idle') collapsed = true
      state = next
      render()
    },
    setStatus(message, status = 'idle') {
      collapsed = false
      state = { ...state, phase: status === 'error' ? 'failed' : status === 'busy' ? 'preparing' : 'notice', message }
      render()
    },
    collapse,
    destroy() { destroyed = true; position.destroy(); document.removeEventListener('pointerdown', closeMenu, true); menu.open = false; host.remove() },
  }
}
