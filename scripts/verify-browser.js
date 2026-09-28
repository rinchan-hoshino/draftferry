import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const executablePath = process.env.DRAFTFERRY_CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync)
if (!executablePath) throw new Error('Set DRAFTFERRY_CHROME_PATH to an installed Chrome/Chromium executable')
const fixtureUrl = 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET'
const helper = await build({
  stdin: { contents: "export { injectPlatformArticle } from './src/platforms.js'", resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'DraftFerryTest', write: false,
})
const fixture = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="rin-platform-fixture" content="tencent-market"></head><body>
  <style>body{font:16px sans-serif;padding:24px}section{margin:20px 0}.w-e-text{min-height:120px}input{width:280px}</style>
  <input id="other" value="其他字段"><p id="outside">正文外内容</p>
  <section><label>商品详情</label><div id="target"></div></section>
  <section><label>客户案例</label><div id="other-editor"></div></section>
  </body></html>`
const browser = await chromium.launch({ executablePath, headless: true })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=', 'base64')
let checks = 0

async function check(name, run) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  page.setDefaultTimeout(7000)
  try {
    await page.route('**/*', route => route.abort())
    await page.route('https://console.cloud.tencent.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }))
    await page.route('https://images.example.test/**', (route) => route.fulfill({ contentType: 'image/png', body: png }))
    await page.goto(fixtureUrl)
    await page.addScriptTag({ path: resolve('node_modules/wangeditor/dist/wangEditor.js') })
    await page.addScriptTag({ content: helper.outputFiles[0].text })
    await page.evaluate(() => {
      const w = globalThis
      w.confirm = () => true
      w.uploadCallbacks = []
      w.native = new w.wangEditor('#target')
      w.native.config.onchangeTimeout = 20
      w.native.config.onchange = (html) => { w.savedHtml = html }
      w.native.config.customUploadImg = (_files, insert) => w.uploadCallbacks.push(insert)
      w.native.create()
      w.native.txt.html('<p>原正文</p>')
      w.otherEditor = new w.wangEditor('#other-editor')
      w.otherEditor.create()
      w.otherEditor.txt.html('<p>其他编辑器原文</p>')
      w.document.querySelector('#target').__reactFiber$fixture = {
        return: { memoizedState: { next: { memoizedState: w.native } } },
      }
      w.article = {
        title: '商品标题',
        html: '<h2>新正文</h2><p>前<img src="data:image/png;base64,eA==">后</p><table><tbody><tr><td>第一格</td><td>第二格</td></tr></tbody></table><pre><code>const x = 1</code></pre>',
        portableMarkdown: '新正文',
      }
      w.startImport = (options = {}) => {
        w.outcome = null
        w.pending = w.DraftFerryTest.injectPlatformArticle(w.document, w.article, {
          fixturePlatformId: 'tencent-market', ...options,
        }).then(() => { w.outcome = 'success' }, (error) => { w.outcome = error.message })
      }
    })
    await run(page)
    checks += 1
    console.log(`PASS ${name}`)
  } finally { await page.close() }
}

try {
  await check('production-shaped React owner references with long outer ancestry', async page => {
    await page.evaluate(() => {
      const w = globalThis
      let outer = { return: null }
      for (let depth = 0; depth < 40; depth++) outer = { return: outer }
      w.document.querySelector('#target').__reactFiber$fixture = {
        stateNode: { state: { productDetails: w.native, customerCase: w.otherEditor } },
        return: outer,
      }
    })
    await page.addScriptTag({ path: resolve('dist/draftferry.user.js') })
    const panel = page.locator('#rin-draftferry-panel')
    await panel.locator('[data-rin-files]').setInputFiles([
      { name: 'product.md', mimeType: 'text/markdown', buffer: Buffer.from('# 商品\n\n修复后的正文![图](one.png)\n\n| 参数 | 值 |\n| --- | --- |\n| 大小 | 一 |') },
      { name: 'one.png', mimeType: 'image/png', buffer: png },
    ])
    await page.waitForFunction(() => globalThis.uploadCallbacks.length === 1)
    await page.locator('#other').fill('上传时继续填写')
    await page.evaluate(() => globalThis.uploadCallbacks[0]('https://images.example.test/repaired.png'))
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'done')
    await page.waitForFunction(() => globalThis.savedHtml?.includes('修复后的正文'))
    assert.match(await page.locator('#target .w-e-text').innerText(), /修复后的正文/)
    assert.equal(await page.locator('#target .w-e-text img').getAttribute('src'), 'https://images.example.test/repaired.png')
    assert.equal(await page.locator('#target .w-e-text td').count(), 2)
    assert.equal(await page.locator('#other-editor .w-e-text').innerText(), '其他编辑器原文')
    assert.equal(await page.locator('#other').inputValue(), '上传时继续填写')
    assert.equal(await page.locator('#target .w-e-text').getAttribute('contenteditable'), 'true')
  })

  await check('native replacement, scoped lock, focus and framework onchange', async (page) => {
    await page.evaluate(() => {
      globalThis.otherEditor.selection.restoreSelection()
      globalThis.startImport()
    })
    assert.equal(await page.locator('#target .w-e-text').getAttribute('contenteditable'), 'false', await page.evaluate(() => globalThis.outcome))
    assert.equal(await page.locator('#target .w-e-text').innerText(), '原正文')
    await page.locator('#target .w-e-text').click({ force: true })
    await page.keyboard.type('SHOULD_NOT_APPEAR')
    await page.keyboard.insertText('不应写入')
    assert.equal(await page.locator('#target .w-e-text').innerText(), '原正文')
    await page.locator('#other').fill('上传时仍可使用其他输入框')
    await page.evaluate(() => {
      globalThis.document.querySelector('#other').setSelectionRange(2, 5)
      globalThis.uploadCallbacks[0]('https://images.example.test/image.png')
      return globalThis.pending
    })
    assert.equal(await page.evaluate(() => globalThis.outcome), 'success')
    await page.waitForFunction(() => globalThis.savedHtml?.includes('第一格'))
    const result = await page.evaluate(() => ({
      focused: globalThis.document.activeElement.id,
      start: globalThis.document.activeElement.selectionStart,
      end: globalThis.document.activeElement.selectionEnd,
      html: globalThis.native.txt.html(),
      other: globalThis.otherEditor.txt.html(),
    }))
    assert.equal(result.focused, 'other')
    assert.deepEqual([result.start, result.end], [2, 5])
    assert.doesNotMatch(result.html, /原正文|data:image|SHOULD_NOT|不应/)
    assert.match(result.html, /前<img[^>]+image\.png[^>]*>后/)
    assert.match(result.html, /<td>第一格<\/td><td>第二格<\/td>/)
    assert.equal(result.other, '<p>其他编辑器原文</p>')
    assert.equal(await page.locator('#outside').innerText(), '正文外内容')
    assert.equal(await page.locator('#target .w-e-text').getAttribute('contenteditable'), 'true')
    await page.locator('#target .w-e-text').click()
    await page.keyboard.type('UNLOCKED')
    assert.match(await page.locator('#target .w-e-text').innerText(), /UNLOCKED/)
  })

  await check('timeout unlocks; late native callbacks cannot erase manual changes', async (page) => {
    await page.evaluate(() => { globalThis.startImport({ imageUploadTimeoutMs: 30 }) })
    await page.waitForFunction(() => globalThis.outcome !== null)
    assert.match(await page.evaluate(() => globalThis.outcome), /上传超时/)
    await page.locator('#target .w-e-text').fill('用户继续编辑')
    await page.evaluate(() => globalThis.uploadCallbacks[0]('https://images.example.test/late.png'))
    await page.waitForFunction(() => globalThis.savedHtml?.includes('用户继续编辑'))
    assert.equal(await page.locator('#target .w-e-text').innerText(), '用户继续编辑')
    assert.equal(await page.locator('#target .w-e-text img').count(), 0)
  })

  await check('navigation during upload stops before any body mutation', async (page) => {
    await page.evaluate(() => {
      globalThis.startImport()
      globalThis.location.hash = 'another-product'
      globalThis.uploadCallbacks[0]('https://images.example.test/image.png')
      return globalThis.pending
    })
    assert.match(await page.evaluate(() => globalThis.outcome), /已停止导入/)
    assert.equal(await page.locator('#target .w-e-text').innerText(), '原正文')
    assert.equal(await page.locator('#target .w-e-text').getAttribute('contenteditable'), 'true')
  })

  await check('native XHR uploader uses its configured endpoint, without global interception', async (page) => {
    let uploadCount = 0
    await page.route('https://upload.example.test/image', async (route) => {
      uploadCount += 1
      assert.equal(route.request().method(), 'POST')
      assert.match(route.request().postData(), /filename="draftferry-1.png"/)
      await route.fulfill({
        contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ errno: 0, data: ['https://images.example.test/native.png'] }),
      })
    })
    await page.evaluate(() => {
      globalThis.originalSend = globalThis.XMLHttpRequest.prototype.send
      globalThis.native.config.customUploadImg = null
      globalThis.native.config.uploadImgServer = 'https://upload.example.test/image'
      globalThis.startImport()
      return globalThis.pending
    })
    assert.equal(await page.evaluate(() => globalThis.outcome), 'success')
    assert.equal(uploadCount, 1)
    assert.equal(await page.evaluate(() => globalThis.XMLHttpRequest.prototype.send === globalThis.originalSend), true)
    assert.equal(await page.locator('#target img').getAttribute('src'), 'https://images.example.test/native.png')
  })

  await check('packaged userscript imports Markdown, local PNG and Mermaid through the compact entry', async (page) => {
    await page.evaluate(() => {
      globalThis.native.config.customUploadImg = (_files, insert) => insert('https://images.example.test/local.png')
    })
    await page.addScriptTag({ path: resolve('dist/draftferry.user.js') })
    const panel = page.locator('#rin-draftferry-panel')
    assert.equal(await panel.locator('[data-rin-status]').isVisible(), false)
    const markdown = '# 商品标题\n\n正文开始\n\n| A | B |\n|---|---|\n| 一 | 二 |\n\n![本地图片](photo.png)\n\n```mermaid\nflowchart LR\n A[开始] --> B[完成]\n```\n\n正文结束'
    await panel.locator('input[type=file]').setInputFiles([
      { name: 'article.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) },
      { name: 'photo.png', mimeType: 'image/png', buffer: png },
    ])
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel')
      ?.shadowRoot.querySelector('[data-rin-status]')?.textContent.includes('手动保存'))
    assert.equal(await page.locator('#target img').count(), 2)
    assert.equal(await page.locator('#target table').count(), 1)
    assert.match(await page.locator('#target .w-e-text').innerText(), /正文开始[\s\S]*正文结束/)
    assert.doesNotMatch(await page.locator('#target .w-e-text').innerText(), /商品标题|原正文/)
    assert.equal(await page.locator('#other').inputValue(), '其他字段')
    await panel.locator('input[type=file]').setInputFiles([
      { name: 'one.md', mimeType: 'text/markdown', buffer: Buffer.from('one') },
      { name: 'two.md', mimeType: 'text/markdown', buffer: Buffer.from('two') },
    ])
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel')
      ?.shadowRoot.querySelector('[data-rin-status]')?.textContent.includes('每次请选择一篇'))
    assert.match(await page.locator('#target .w-e-text').innerText(), /正文开始/)
  })

  await check('missing images resume the same draft; partial upload retry skips completed images', async page => {
    await page.evaluate(() => {
      globalThis.uploadAttempts = []
      globalThis.native.config.customUploadImg = (files, insert) => {
        globalThis.uploadAttempts.push(files[0].name)
        if (globalThis.uploadAttempts.length === 2) return Promise.reject(new Error('temporary failure'))
        insert(`https://images.example.test/${globalThis.uploadAttempts.length}.png`)
      }
    })
    await page.addScriptTag({ path: resolve('dist/draftferry.user.js') })
    const panel = page.locator('#rin-draftferry-panel')
    await panel.locator('[data-rin-files]').setInputFiles({ name: 'resume.md', mimeType: 'text/markdown', buffer: Buffer.from('# 同一篇稿件\n\n前![一](one.png)中![二](two.png)后') })
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'missing')
    assert.equal(await page.locator('#target .w-e-text').innerText(), '原正文')
    const chooser = page.waitForEvent('filechooser')
    await panel.locator('[data-primary]').click()
    await (await chooser).setFiles([
      { name: 'one.png', mimeType: 'image/png', buffer: png },
      { name: 'two.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from('second')]) },
    ])
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'failed')
    assert.deepEqual(await page.evaluate(() => globalThis.uploadAttempts), ['draftferry-1.png', 'draftferry-2.png'])
    assert.equal(await page.locator('#target .w-e-text').innerText(), '原正文')
    assert.match(await panel.locator('.assets').innerText(), /two.png/)
    await panel.locator('[data-primary]').click()
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'done')
    assert.deepEqual(await page.evaluate(() => globalThis.uploadAttempts), ['draftferry-1.png', 'draftferry-2.png', 'draftferry-2.png'])
    assert.deepEqual(await page.locator('#target img').evaluateAll(images => images.map(image => image.src)), ['https://images.example.test/1.png', 'https://images.example.test/3.png'])
    assert.match(await page.locator('#target .w-e-text').innerText(), /前中后/)
    assert.equal(await page.locator('#target .w-e-text [style]').count(), 0)
  })

  await check('minimized progress stays minimized; pause unlocks and late upload cannot change user text', async page => {
    await page.addScriptTag({ path: resolve('dist/draftferry.user.js') })
    const panel = page.locator('#rin-draftferry-panel')
    await panel.locator('[data-rin-files]').setInputFiles([
      { name: 'pause.md', mimeType: 'text/markdown', buffer: Buffer.from('# 稿件\n\n正文![图](one.png)') },
      { name: 'one.png', mimeType: 'image/png', buffer: png },
    ])
    await page.waitForFunction(() => globalThis.uploadCallbacks.length === 1)
    await panel.locator('[data-primary]').click()
    assert.equal(await panel.locator('.workbench').isVisible(), false)
    await page.locator('#other').fill('正常处理别的字段')
    await panel.locator('[data-rin-action="import"]').click()
    await panel.locator('[data-secondary]').click()
    await page.waitForFunction(() => globalThis.document.querySelector('#target .w-e-text').getAttribute('contenteditable') === 'true')
    await page.locator('#target .w-e-text').fill('暂停后继续手动编辑')
    await page.evaluate(() => globalThis.uploadCallbacks[0]('https://images.example.test/late.png'))
    assert.equal(await page.locator('#target .w-e-text').innerText(), '暂停后继续手动编辑')
    await panel.locator('[data-primary]').click()
    await page.waitForFunction(() => globalThis.uploadCallbacks.length === 2)
    await panel.locator('[data-primary]').click()
    await page.evaluate(() => globalThis.uploadCallbacks[1]('https://images.example.test/retried.png'))
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'done')
    assert.equal(await panel.locator('.workbench').isVisible(), false)
    assert.match(await panel.locator('[data-rin-action="import"]').innerText(), /已完成/)
    assert.equal(await page.locator('#other').inputValue(), '正常处理别的字段')
  })

  await check('route changes retain the draft and stop late callbacks; returning requires explicit resume', async page => {
    await page.addScriptTag({ path: resolve('dist/draftferry.user.js') })
    let panel = page.locator('#rin-draftferry-panel')
    await panel.locator('[data-rin-files]').setInputFiles([
      { name: 'route.md', mimeType: 'text/markdown', buffer: Buffer.from('# 保留这篇\n\n继续正文![图](one.png)') },
      { name: 'one.png', mimeType: 'image/png', buffer: png },
    ])
    await page.waitForFunction(() => globalThis.uploadCallbacks.length === 1)
    await page.evaluate(() => globalThis.history.pushState(null, '', '/serviceprovider/products/list'))
    await page.waitForFunction(() => !globalThis.document.querySelector('#rin-draftferry-panel'))
    await page.evaluate(() => globalThis.uploadCallbacks[0]('https://images.example.test/late.png'))
    assert.equal(await page.locator('#target .w-e-text').innerText(), '原正文')
    assert.equal(await page.locator('#target .w-e-text').getAttribute('contenteditable'), 'true')
    await page.evaluate(url => globalThis.history.pushState(null, '', url), fixtureUrl)
    panel = page.locator('#rin-draftferry-panel')
    await panel.locator('[data-rin-action="import"]').click()
    assert.equal(await panel.locator('h2').innerText(), '保留这篇')
    assert.equal(await page.evaluate(() => globalThis.uploadCallbacks.length), 1)
    await panel.locator('[data-primary]').click()
    await page.waitForFunction(() => globalThis.uploadCallbacks.length === 2)
    await page.evaluate(() => globalThis.uploadCallbacks[1]('https://images.example.test/returned.png'))
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'done')
    assert.match(await page.locator('#target .w-e-text').innerText(), /继续正文/)
  })

  await check('new panel fits narrow viewports and keeps missing filenames readable', async page => {
    await page.addScriptTag({ path: resolve('dist/draftferry.user.js') })
    const panel = page.locator('#rin-draftferry-panel')
    await panel.locator('[data-rin-files]').setInputFiles({ name: '云服务产品介绍.md', mimeType: 'text/markdown', buffer: Buffer.from('# 云服务产品介绍\n\n![架构](images/service-architecture-overview.png)') })
    await page.waitForFunction(() => globalThis.document.querySelector('#rin-draftferry-panel').shadowRoot.querySelector('.workbench').dataset.state === 'missing')
    const proof = resolve('../draftferry-design-20260926/implementation')
    await mkdir(proof, { recursive: true })
    await panel.screenshot({ path: resolve(proof, 'missing-image.png') })
    await page.setViewportSize({ width: 340, height: 740 })
    const overflow = await panel.evaluate(host => {
      const surface = host.shadowRoot.querySelector('.workbench')
      return { width: surface.clientWidth, scroll: surface.scrollWidth, right: host.getBoundingClientRect().right }
    })
    assert.ok(overflow.scroll <= overflow.width + 1)
    assert.ok(overflow.right <= 340)
    await panel.screenshot({ path: resolve(proof, 'mobile.png') })
    const lightBackground = await panel.evaluate(host => globalThis.getComputedStyle(host.shadowRoot.querySelector('.workbench')).backgroundColor)
    await page.emulateMedia({ colorScheme: 'dark' })
    const darkBackground = await panel.evaluate(host => globalThis.getComputedStyle(host.shadowRoot.querySelector('.workbench')).backgroundColor)
    assert.notEqual(darkBackground, lightBackground)
    await panel.screenshot({ path: resolve(proof, 'dark.png') })
  })
  console.log(`Browser verification: ${checks} scenarios passed (real wangEditor 4.7.15; isolated Chrome).`)
} finally {
  await browser.close()
}
