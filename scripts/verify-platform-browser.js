import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const executablePath = process.env.DRAFTFERRY_CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync)
if (!executablePath) throw new Error('Set DRAFTFERRY_CHROME_PATH to an installed Chrome/Chromium executable')
const helper = await build({
  stdin: { contents: `
    export { createDraft, renderDraft } from './src/draft.js'
    export { injectPlatformArticle } from './src/platforms.js'
    export { downloadDiagnosticFile } from './src/diagnostic-file.js'
    export { Schema, DOMParser as ProseMirrorDOMParser } from 'prosemirror-model'
    export { EditorState } from 'prosemirror-state'
    export { EditorView } from 'prosemirror-view'
  `, resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'DraftFerryTest', write: false,
})
const browser = await chromium.launch({ executablePath, headless: true })
const userscript = await readFile(resolve('dist/draftferry.user.js'), 'utf8')
const proseMirrorStyles = await readFile(resolve('node_modules/prosemirror-view/style/prosemirror.css'), 'utf8')
const userscriptMatches = [...userscript.matchAll(/^\/\/ @match\s+(\S+)/gm)].map(([, pattern]) =>
  new RegExp(`^${pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`))
let checks = 0
async function check(name, url, run) {
  const page = await browser.newPage({ locale: 'zh-CN', acceptDownloads: true })
  page.setDefaultTimeout(7000)
  try {
    await page.route('**/*', route => route.abort())
    await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>' }))
    await page.goto(url)
    await page.addScriptTag({ content: helper.outputFiles[0].text })
    await run(page)
    checks++
    console.log(`PASS ${name}`)
  } finally { await page.close() }
}

try {
  await check('浮条避开底部按钮，拖动不触发导入，位置按网站保留', 'https://mp.toutiao.com/profile_v4/graphic/publish', async page => {
    await page.evaluate(() => {
      const { document } = globalThis
      document.body.innerHTML = '<textarea id="other">继续编辑</textarea><button id="publish" style="position:fixed;right:16px;bottom:16px;width:100px;height:40px">发布</button>'
      globalThis.fileClicks = 0
      globalThis.published = 0
      document.querySelector('#publish').onclick = () => { globalThis.published++ }
    })
    await page.addScriptTag({ content: userscript })
    const panel = page.locator('#rin-draftferry-panel')
    const handle = panel.locator('.toolbar .drag-handle')
    const viewport = page.viewportSize()
    const initial = await panel.boundingBox()
    assert.ok(Math.abs(initial.y + initial.height / 2 - viewport.height / 2) < 2)
    assert.ok(Math.abs(initial.x + initial.width - viewport.width + 16) < 2)
    await page.locator('#publish').click()
    assert.equal(await page.evaluate(() => globalThis.published), 1)
    await page.evaluate(() => {
      const { document } = globalThis
      const input = document.querySelector('#other')
      input.focus()
      input.setSelectionRange(1, 3)
      document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('[data-rin-files]').addEventListener('click', event => {
        event.preventDefault()
        globalThis.fileClicks++
      })
    })
    const grip = await handle.boundingBox()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2 - 240, grip.y + grip.height / 2 - 100, { steps: 8 })
    await page.mouse.up()
    const moved = await panel.boundingBox()
    assert.ok(Math.abs(initial.x - moved.x - 240) < 2)
    assert.ok(Math.abs(initial.y - moved.y - 100) < 2)
    assert.deepEqual(await page.evaluate(() => {
      const { document } = globalThis
      return [globalThis.fileClicks, document.activeElement.id, document.querySelector('#other').selectionStart, document.querySelector('#other').selectionEnd]
    }), [0, 'other', 1, 3])
    await page.reload()
    await page.addScriptTag({ content: userscript })
    await page.waitForFunction(({ x, y }) => {
      const rect = globalThis.document.querySelector('#rin-draftferry-panel').getBoundingClientRect()
      return Math.abs(rect.x - x) < 2 && Math.abs(rect.y - y) < 2
    }, moved)
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    assert.ok(Math.abs((await panel.boundingBox()).x - moved.x + 10) < 2)
    await panel.locator('summary').click()
    await panel.locator('[data-action="reset-position"]').click()
    assert.ok(Math.abs((await panel.boundingBox()).x - initial.x) < 2)
    // Leave this website with a nondefault position, then open a second origin.
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    const secondUrl = 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle'
    await page.route(secondUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
    await page.goto(secondUrl)
    await page.addScriptTag({ content: userscript })
    assert.ok(Math.abs((await panel.boundingBox()).x - initial.x) < 2)
  })

  await check('窄屏、展开和禁止存储时浮条仍可移动且菜单留在屏内', 'https://mp.toutiao.com/profile_v4/graphic/publish', async page => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.evaluate(() => {
      Object.defineProperty(globalThis, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError') } })
    })
    await page.addScriptTag({ content: userscript })
    const panel = page.locator('#rin-draftferry-panel')
    await panel.locator('[data-rin-files]').setInputFiles({ name: '窄屏.md', mimeType: 'text/markdown', buffer: Buffer.from('# 一篇需要补充图片的稿件\n\n![待补图片](missing.png)') })
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'missing')
    let rect = await panel.boundingBox()
    assert.ok(rect.x >= 15 && rect.y >= 15 && rect.x + rect.width <= 305 && rect.y + rect.height <= 553, JSON.stringify(rect))
    const handle = panel.locator('.header .drag-handle')
    await handle.focus()
    for (let index = 0; index < 20; index++) await page.keyboard.press('Shift+ArrowUp')
    rect = await panel.boundingBox()
    assert.ok(Math.abs(rect.y - 16) < 2)
    await panel.locator('.dismiss').click()
    const compactHandle = panel.locator('.toolbar .drag-handle')
    await compactHandle.focus()
    for (let index = 0; index < 20; index++) await page.keyboard.press('Shift+ArrowDown')
    await panel.locator('summary').click()
    await panel.locator('details[data-above="true"]').waitFor()
    const menu = await panel.locator('.menu').boundingBox()
    assert.ok(menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= 320 && menu.y + menu.height <= 568, JSON.stringify(menu))
    await page.setViewportSize({ width: 736, height: 420 })
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').getBoundingClientRect().bottom <= 405)
    rect = await panel.boundingBox()
    assert.ok(rect.x >= 15 && rect.y >= 15 && rect.x + rect.width <= 721 && rect.y + rect.height <= 405, JSON.stringify(rect))
  })

  await check('导入成功直接恢复入口，连续发稿、站内切页和刷新不保留上一篇面板', 'https://mp.toutiao.com/profile_v4/graphic/publish', async page => {
    await page.evaluate(() => {
      globalThis.document.body.innerHTML = '<textarea placeholder="请输入标题"></textarea><div class="ProseMirror" contenteditable="true"></div>'
    })
    await page.addScriptTag({ content: userscript })
    const panel = page.locator('#rin-draftferry-panel')
    const entry = panel.locator('[data-rin-action="import"]')
    async function choose(markdown) {
      const chooser = page.waitForEvent('filechooser')
      await entry.click()
      await (await chooser).setFiles({ name: '稿件.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
      await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'idle')
      assert.equal(await entry.innerText(), '导入 Markdown')
      assert.equal(await panel.locator('.workbench').isVisible(), false)
      assert.equal(await panel.locator('[data-rin-files]').inputValue(), '')
      assert.equal(await panel.locator('h2').textContent(), '准备稿件')
    }
    await choose('# 第一篇\n\n第一篇正文')
    assert.equal(await page.locator('textarea').inputValue(), '第一篇')
    assert.equal(await page.locator('.ProseMirror').innerText(), '第一篇正文')

    // The platform starts another article in the same editor and at the same
    // URL. The ordinary entry must still open the chooser, without a menu.
    await page.locator('textarea').fill('')
    await page.locator('.ProseMirror').fill('')
    await choose('# 第二篇\n\n第二篇正文')
    assert.equal(await page.locator('textarea').inputValue(), '第二篇')
    assert.equal(await page.locator('.ProseMirror').innerText(), '第二篇正文')

    await page.evaluate(() => globalThis.history.pushState({}, '', '/profile_v4/index'))
    await panel.waitFor({ state: 'detached' })
    await page.evaluate(() => globalThis.history.pushState({}, '', '/profile_v4/graphic/publish'))
    await panel.waitFor({ state: 'attached' })
    assert.equal(await entry.innerText(), '导入 Markdown')
    assert.equal(await panel.locator('h2').textContent(), '准备稿件')
    assert.equal(await page.locator('.ProseMirror').innerText(), '第二篇正文')
    const chooser = page.waitForEvent('filechooser')
    await entry.click()
    await (await chooser).setFiles([])
    assert.equal(await entry.innerText(), '导入 Markdown')
    await page.reload()
    await page.addScriptTag({ content: userscript })
    assert.equal(await entry.innerText(), '导入 Markdown')
    assert.equal(await panel.locator('.workbench').isVisible(), false)
  })

  for (const [name, startUrl, legacy] of [
    ['阿里云从控制台首次进入编辑页无需刷新', 'https://msp.aliyun.com/', false],
    ['阿里云缺少导航通知时空闲切页仍能挂载', 'https://msp.aliyun.com/msp/commodity/list', true],
  ]) {
    await check(name, startUrl, async page => {
      // Model the userscript manager's initial @match gate before evaluating the
      // actual release artifact; a script cannot handle routes if never loaded.
      assert.ok(userscriptMatches.some(match => match.test(startUrl)), `启动地址未被用户脚本覆盖：${startUrl}`)
      if (legacy) await page.evaluate(() => {
        Object.defineProperty(globalThis, 'navigation', { value: undefined, configurable: true })
      })
      await page.addScriptTag({ content: userscript })
      const panel = page.locator('#rin-draftferry-panel')
      assert.equal(await panel.count(), 0)
      await page.evaluate(() => {
        globalThis.history.pushState({}, '', '/msp/commodity/list/~/publish/basic?commodityId=69735')
      })
      await panel.waitFor({ state: 'attached' })
      assert.equal(await panel.count(), 1)
      await page.evaluate(() => globalThis.history.replaceState({}, '', '/msp/commodity/list'))
      await panel.waitFor({ state: 'detached' })
      assert.equal(await page.locator('input,textarea,[contenteditable]').count(), 0)
    })
  }

  await check('搜狐真实 Quill 保留两级标题、深层加粗及代码字面量', 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle', async page => {
    // The optional snapshot runs the same check against Sohu's downloaded
    // production Quill. Normal check remains offline with the pinned version.
    const snapshot = process.env.DRAFTFERRY_SOHU_SNAPSHOT
    if (snapshot) {
      for (const name of ['sohu-content-chunk-libs.21765eb02e.js', 'sohu-editor-only.js']) {
        await page.addScriptTag({ path: resolve(snapshot, name) })
      }
    } else {
      await page.addScriptTag({ path: resolve('node_modules/quill/dist/quill.js') })
    }
    const result = await page.evaluate(async () => {
      const window = globalThis
      const { document } = window
      document.body.innerHTML = '<input id="other" value="继续编辑"><input placeholder="请输入标题"><div id="editor"></div><div id="other-editor"></div>'
      globalThis.confirm = () => true
      const Quill = globalThis.SohuQuill ?? globalThis.Quill
      const quill = new Quill('#editor', { theme: 'snow' })
      const otherQuill = new Quill('#other-editor', { theme: 'snow' })
      otherQuill.setText('另一个编辑器原文')
      const Delta = Quill.import('delta')
      // Current Sohu source (202609181124): clipboard matchers flatten H3–H6.
      // https://g1.itc.cn/bsf-mp-prod/mp_micro_contentmanager/202609181124/dist/js/app.21765eb02e.js
      for (const tag of ['H3', 'H4', 'H5', 'H6']) {
        quill.clipboard.addMatcher(tag, (node, delta) => {
          const attributes = delta?.ops?.[0]?.attributes
          if (attributes) delete attributes.header
          return new Delta().insert(`${node.innerText}\n`, attributes)
        })
      }
      const data = {}
      Object.defineProperty(data, '__ob__', { value: {} })
      Object.defineProperty(data, 'quill', { get: () => quill, set() {} })
      document.querySelector('#editor').__vue__ = { _data: data }
      // A same-size second editor should not be selected or overwritten.
      otherQuill.root.parentElement.hidden = true
      const other = document.querySelector('#other')
      other.focus()
      other.setSelectionRange(1, 3)
      const api = globalThis.DraftFerryTest
      const article = api.renderDraft(api.createDraft('# 文章\n\n## 业务背景\n\n正文\n\n### 同步说明\n\n#### 小步骤\n\n##### 细节\n\n###### 末级\n\n```md\n## 代码字面量\n```', { windowObject: window }))
      // Prove this fixture reproduces the platform loss before exercising import.
      const before = quill.clipboard.convert({ html: article.html })
      await api.injectPlatformArticle(document, article)
      return {
        version: Quill.version, beforeHeaders: before.ops.filter(op => op.attributes?.header).map(op => op.attributes.header),
        headings: [...quill.root.querySelectorAll('h1,h2')].map(node => [node.tagName, node.textContent]),
        deeper: [...quill.root.querySelectorAll('p > strong')].map(node => node.textContent),
        text: quill.getText(), title: document.querySelector('input[placeholder]').value,
        otherText: otherQuill.getText(), focus: document.activeElement.id, selection: [other.selectionStart, other.selectionEnd],
      }
    })
    assert.equal(result.version, '2.0.3')
    assert.deepEqual(result.beforeHeaders, [2])
    assert.deepEqual(result.headings, [['H1', '业务背景'], ['H2', '同步说明']])
    assert.deepEqual(result.deeper, ['小步骤', '细节', '末级'])
    assert.match(result.text, /## 代码字面量/)
    assert.equal(result.title, '文章')
    assert.equal(result.otherText.trim(), '另一个编辑器原文')
    assert.equal(result.focus, 'other')
    assert.deepEqual(result.selection, [1, 3])
  })

  await check('微信诊断下载不触发页面导航且文件字节完整', 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2', async page => {
    await page.evaluate(() => {
      const window = globalThis
      const { document, location } = window
      globalThis.hijacked = 0
      document.addEventListener('click', event => {
        const link = event.target.closest('a')
        if (!link) return
        globalThis.hijacked++
        event.preventDefault()
        location.href = link.href
      }, true)
      const button = document.createElement('button')
      button.textContent = '下载诊断'
      button.onclick = () => globalThis.DraftFerryTest.downloadDiagnosticFile({
        windowObject: window, document, text: JSON.stringify({ message: '完整诊断', sample: 'x'.repeat(500_000) }),
        platformId: 'wechat', version: 'test', now: new Date('2026-09-28T08:00:00Z'),
      })
      document.body.append(button)
    })
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button').click()])
    assert.equal(await download.failure(), null)
    assert.equal(download.suggestedFilename(), 'draftferry-diagnostic-wechat-test-20260928-080000.txt')
    const content = JSON.parse(await readFile(await download.path(), 'utf8'))
    assert.equal(content.message, '完整诊断')
    assert.equal(content.sample.length, 500_000)
    assert.equal(await page.evaluate(() => globalThis.hijacked), 0)
    assert.match(page.url(), /appmsg\?t=/)
    assert.equal(await page.locator('a').count(), 0)
  })

  await check('微信标题经过块级规范化后仍有层级与加粗', 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2', async page => {
    const result = await page.evaluate(async () => {
      const window = globalThis
      const { document } = window
      document.body.innerHTML = '<style>body{font-size:16px}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:normal}</style><textarea id="title"></textarea><div class="ProseMirror"></div>'
      globalThis.__MP_Editor_JSAPI__ = { invoke({ apiParam, sucCb }) {
        const body = document.querySelector('.ProseMirror')
        body.innerHTML = apiParam.content
        // Model the host normalizing block tags while retaining inline formats.
        for (const heading of body.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
          const paragraph = document.createElement('p')
          paragraph.append(...heading.childNodes)
          heading.replaceWith(paragraph)
        }
        sucCb()
      } }
      const api = globalThis.DraftFerryTest
      const article = api.renderDraft(api.createDraft('# 文章\n\n## 业务背景\n\n### 同步说明\n\n#### 小步骤\n\n普通正文\n\n```md\n## 代码字面量\n```', { windowObject: window }))
      await api.injectPlatformArticle(document, article)
      const body = document.querySelector('.ProseMirror')
      return {
        sizes: [...body.querySelectorAll('span')].map(span => parseFloat(window.getComputedStyle(span).fontSize)),
        weights: [...body.querySelectorAll('strong')].map(strong => Number(window.getComputedStyle(strong).fontWeight)),
        title: document.querySelector('#title').value, code: body.querySelector('pre').textContent.trim(),
      }
    })
    assert.equal(result.title, '文章')
    assert.equal(result.code, '## 代码字面量')
    assert.equal(result.sizes.length, 3)
    assert.ok(result.sizes[0] > result.sizes[1] && result.sizes[1] > result.sizes[2] && result.sizes[2] > 16)
    assert.ok(result.weights.every(weight => weight >= 700))
  })
  for (const [ending, html, completeScript = false] of [
    ['表格', '<table><tbody><tr><td><p>客户资料</p></td></tr></tbody></table>'],
    ['图片', '<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" alt="流程图"></p>'],
    ['列表', '<ul><li><p>客户资料</p></li></ul>'],
    ['引用', '<blockquote><p>客户资料</p></blockquote>'],
    ['代码', '<pre><code>客户资料</code></pre>'],
    ['正文', '<p>客户资料</p>'],
    ['表格与图片整篇导入', '<table><tbody><tr><td><p>客户资料</p></td></tr></tbody></table><p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" alt="流程图"></p>', true],
  ]) {
    await check(`微信${ending}结尾可在真实 ProseMirror 中点击并继续输入`, 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2', async page => {
      await page.evaluate(async ({ html, completeScript }) => {
        const { document } = globalThis
        const api = globalThis.DraftFerryTest
        document.body.innerHTML = '<style>.ProseMirror{outline:1px solid #ddd}td{border:1px solid}img[src]{width:40px;height:40px}</style><textarea id="title"></textarea><input id="other"><div id="editor"></div>'
        // A real editor with a controlled schema and content API, not WeChat's
        // private build. Browser input updates its document through transactions.
        const schema = new api.Schema({ nodes: {
          doc: { content: 'block+' },
          text: { group: 'inline' },
          paragraph: { content: 'inline*', group: 'block', attrs: { style: { default: null } },
            parseDOM: [{ tag: 'p', getAttrs: node => ({ style: node.getAttribute('style') }) }],
            toDOM: node => ['p', node.attrs.style ? { style: node.attrs.style } : {}, 0] },
          image: { inline: true, group: 'inline', attrs: { src: {}, alt: { default: null } },
            parseDOM: [{ tag: 'img[src]', getAttrs: node => ({ src: node.getAttribute('src'), alt: node.getAttribute('alt') }) }],
            toDOM: node => ['img', node.attrs] },
          hard_break: { inline: true, group: 'inline', parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
          table: { content: 'table_row+', group: 'block', parseDOM: [{ tag: 'table' }], toDOM: () => ['table', ['tbody', 0]] },
          table_row: { content: 'table_cell+', parseDOM: [{ tag: 'tr' }], toDOM: () => ['tr', 0] },
          table_cell: { content: 'block+', isolating: true, parseDOM: [{ tag: 'td' }, { tag: 'th' }], toDOM: () => ['td', 0] },
          bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
          list_item: { content: 'paragraph block*', parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
          blockquote: { content: 'block+', group: 'block', parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
          code_block: { content: 'text*', group: 'block', code: true, marks: '',
            parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', ['code', 0]] },
        } })
        globalThis.wechatView = new api.EditorView(document.querySelector('#editor'), { state: api.EditorState.create({ schema }) })
        globalThis.__MP_Editor_JSAPI__ = { invoke({ apiParam, sucCb }) {
          const content = document.createElement('div')
          content.innerHTML = apiParam.content
          globalThis.wechatView.updateState(api.EditorState.create({ schema, doc: api.ProseMirrorDOMParser.fromSchema(schema).parse(content) }))
          sucCb()
        } }
        document.querySelector('#other').focus()
        if (!completeScript) await api.injectPlatformArticle(document, { title: '对接说明', html, portableMarkdown: '客户资料' })
      }, { html, completeScript })
      await page.addStyleTag({ content: proseMirrorStyles })
      if (completeScript) {
        await page.addScriptTag({ content: userscript })
        await page.locator('#rin-draftferry-panel').locator('[data-rin-files]').setInputFiles({
          name: '对接说明.md', mimeType: 'text/markdown', buffer: Buffer.from(`# 对接说明\n\n${html}`),
        })
        await page.waitForFunction(() => globalThis.wechatView.state.doc.textContent.includes('客户资料')
          && globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'idle')
        assert.equal(await page.locator('#title').inputValue(), '对接说明')
        assert.equal(await page.locator('.ProseMirror table').count(), 1)
        assert.equal(await page.locator('.ProseMirror img[alt="流程图"]').count(), 1)
      }
      assert.equal(await page.evaluate(() => globalThis.document.activeElement.id), 'other', '导入不抢输入焦点')
      const tail = page.locator('.ProseMirror > :last-child')
      assert.equal(await tail.evaluate(node => node.tagName), 'P')
      assert.equal(await tail.textContent(), '')
      const bounds = await tail.boundingBox()
      assert.ok(bounds.height >= 16, '末尾有可点击的输入行')
      await tail.click({ position: { x: 5, y: bounds.height / 2 } })
      await page.keyboard.type('追加正文')
      await page.waitForFunction(() => globalThis.wechatView.state.doc.lastChild.textContent === '追加正文')
      assert.equal(await tail.textContent(), '追加正文')
      const result = await page.evaluate(() => {
        const view = globalThis.wechatView
        return { lastType: view.state.doc.lastChild.type.name, lastText: view.state.doc.lastChild.textContent,
          depth: view.state.selection.$from.depth, firstText: view.state.doc.firstChild.textContent,
          fontSize: globalThis.getComputedStyle(view.dom.lastElementChild).fontSize }
      })
      assert.equal(result.lastType, 'paragraph')
      assert.equal(result.lastText, '追加正文')
      assert.equal(result.depth, 1, '续写不进入表格、列表或引用内部')
      assert.equal(result.firstText, ending === '图片' ? '' : '客户资料', '原内容保留')
      assert.equal(result.fontSize, '16px')
    })
  }
} finally { await browser.close() }
console.log(`Platform browser verification: ${checks} scenarios passed`)
