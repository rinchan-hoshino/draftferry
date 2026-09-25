import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const executablePath = process.env.DRAFTFERRY_CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync)
if (!executablePath) throw new Error('Set DRAFTFERRY_CHROME_PATH to an installed Chrome/Chromium executable')
const directory = await mkdtemp(resolve(tmpdir(), 'draftferry-browser-'))
const fixture = resolve(directory, 'fixture.html')
const helper = await build({
  stdin: { contents: "export { injectPlatformArticle } from './src/platforms.js'", resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'DraftFerryTest', write: false,
})
await writeFile(fixture, `<!doctype html><html><head><meta charset="utf-8">
  <meta name="rin-platform-fixture" content="tencent-market"></head><body>
  <style>body{font:16px sans-serif;padding:24px}section{margin:20px 0}.w-e-text{min-height:120px}input{width:280px}</style>
  <input id="other" value="其他字段"><p id="outside">正文外内容</p>
  <section><label>商品详情</label><div id="target"></div></section>
  <section><label>客户案例</label><div id="other-editor"></div></section>
  </body></html>`)
const browser = await chromium.launch({ executablePath, headless: true })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=', 'base64')
let checks = 0

async function check(name, run) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  page.setDefaultTimeout(7000)
  try {
    await page.route('https://images.example.test/**', (route) => route.fulfill({ contentType: 'image/png', body: png }))
    await page.goto(pathToFileURL(fixture).href)
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
      ?.shadowRoot.querySelector('[data-rin-status]')?.textContent.includes('请预览后手动保存'))
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
      ?.shadowRoot.querySelector('[data-rin-status]')?.textContent.includes('每次请选择一个'))
    assert.match(await page.locator('#target .w-e-text').innerText(), /正文开始/)
  })
  console.log(`Browser verification: ${checks} scenarios passed (real wangEditor 4.7.15; isolated Chrome).`)
} finally {
  await browser.close()
  await rm(directory, { recursive: true, force: true })
}
