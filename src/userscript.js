/* global __DRAFTFERRY_VERSION__, unsafeWindow */
import { buildDiagnosticFile, downloadDiagnosticFile } from './diagnostic-file.js'
import { renderMermaidPng } from './mermaid-png.js'
import { createPanel } from './panel.js'
import { createPlatformTarget, detectPlatform, getPlatformById } from './platforms.js'
import { ImportTask } from './import-task.js'
import { observePageLocation } from './page-location.js'

const page = window
const pageDocument = document
let panel
let selectedContext
let panelPlatformId

function getPageWindow() {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document) return unsafeWindow
  } catch { /* Userscript managers may not expose a page bridge. */ }
  return page
}

function currentPlatform() {
  const fixture = pageDocument.querySelector('meta[name="rin-platform-fixture"]')?.content
  if (page.location.protocol === 'file:' && fixture) return getPlatformById(fixture)
  return detectPlatform(page.location)
}

function currentContext() {
  const platform = currentPlatform()
  if (!platform) return null
  const field = platform.id === 'tencent-market' ? '商品详情' : platform.id === 'aliyun-market' ? '产品详情' : '文章正文'
  return { platformId: platform.id, destination: `${platform.name} → ${field}`, field, url: page.location.href }
}

const task = new ImportTask({
  windowObject: page,
  renderMermaid: renderMermaidPng,
  locateTarget: context => createPlatformTarget(pageDocument, {
    fixturePlatformId: context.platformId,
    pageWindow: getPageWindow(),
  }),
  onChange: state => {
    if (state.phase === 'idle') selectedContext = null
    panel?.setState(state)
  },
})

function diagnose() {
  const platform = currentPlatform()
  if (!platform) return
  try {
    const pageWindow = getPageWindow()
    const runtimeDocument = pageWindow.document ?? pageDocument
    const text = buildDiagnosticFile({ document: runtimeDocument, pageWindow, platformId: platform.id, version: __DRAFTFERRY_VERSION__ })
    const filename = downloadDiagnosticFile({ windowObject: pageWindow, document: runtimeDocument, text, platformId: platform.id, version: __DRAFTFERRY_VERSION__ })
    panel.setStatus(`已开始下载诊断：${filename}`)
  } catch (error) { panel.setStatus(error.message || String(error), 'error') }
}

function onAction(action) {
  const context = currentContext()
  if (action === 'diagnose') { diagnose(); return }
  if (action === 'pause') { task.pause(); return }
  if (!context) { panel?.setStatus('请先回到目标平台的编辑页面', 'error'); return }
  if (action === 'resume' && (task.pool || task.selectedFiles)) { void task.resume(context); return }
  if (task.busy) return
  selectedContext = context
  panel.chooseFiles(action === 'supplement' ? 'supplement' : 'new')
}

function mount(platform) {
  panel = createPanel(pageDocument, platform.name, onAction)
  panelPlatformId = platform.id
  panel.setState(task.state)
  const mounted = panel
  mounted.fileInput.addEventListener('change', () => {
    const files = [...mounted.fileInput.files]
    mounted.fileInput.value = ''
    if (!files.length || task.busy) return
    const context = selectedContext ?? currentContext()
    if (!context) { mounted.setStatus('请先进入目标平台的编辑页面', 'error'); return }
    if (mounted.fileMode === 'supplement') void task.resume(context, files)
    else void task.start(files, context)
  })
}

function syncPanel() {
  task.checkRoute()
  const platform = currentPlatform()
  if (!platform) {
    panel?.destroy()
    panel = null
    panelPlatformId = null
    return
  }
  if (panel && panelPlatformId !== platform.id) { panel.destroy(); panel = null }
  if (!panel) mount(platform)
  if (!panel.host.isConnected && pageDocument.body) pageDocument.body.append(panel.host)
}

syncPanel()
const observer = new page.MutationObserver(syncPanel)
observer.observe(pageDocument.body, { childList: true })
observePageLocation(page, syncPanel)
page.addEventListener('pagehide', () => {
  observer.disconnect()
  task.pause('页面已离开，导入已暂停。')
})
page.addEventListener('pageshow', () => {
  observer.observe(pageDocument.body, { childList: true })
  syncPanel()
})
