import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const executablePath = process.env.DRAFTFERRY_CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync)
if (!executablePath) throw new Error('Set DRAFTFERRY_CHROME_PATH to an installed Chrome/Chromium executable')
const root = resolve('node_modules/ckeditor4')
const helper = await build({
  stdin: { contents: `export { injectPlatformArticle } from './src/platforms.js'`, resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'DraftFerryTest', write: false,
})
const browser = await chromium.launch({ executablePath, headless: true })
const url = 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=69735'
const fixture = '<!doctype html><html><head><meta charset="utf-8"></head><body><input id="other" value="其他字段"><div class="next-form-item"><label>产品详情：</label><textarea id="editor3"></textarea></div><div class="next-form-item"><label>服务说明：</label><textarea id="editor4"></textarea></div></body></html>'
let checks = 0

async function beginImageUpload(page) {
  let respond
  const response = new Promise(resolve => { respond = resolve })
  await page.route('**/upload', async route => {
    const payload = await response
    try { await route.fulfill(payload) } catch { /* Cancellation can close the request first. */ }
  })
  const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/upload')
  await page.evaluate(() => {
    const { document, DraftFerryTest } = globalThis
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII='
    globalThis.controller = new AbortController()
    globalThis.operation = DraftFerryTest.injectPlatformArticle(document,
      globalThis.makeArticle(`<h2>图片导入</h2><p>图片前</p><img src="${png}"><p>图片后</p>`),
      { signal: globalThis.controller.signal, imageUploadTimeoutMs: 5000 },
    ).then(() => ({ ok: true }), error => ({ ok: false, message: error.message, name: error.name }))
  })
  await requested
  return respond
}

async function check(name, run) {
  const page = await browser.newPage({ locale: 'zh-CN' })
  page.setDefaultTimeout(8000)
  try {
    await page.route('**/*', async route => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.pathname.startsWith('/ckeditor/')) {
        const path = resolve(root, requestUrl.pathname.slice('/ckeditor/'.length))
        assert.ok(path.startsWith(root + sep))
        const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }
        try { await route.fulfill({ body: await readFile(path), contentType: types[extname(path)] ?? 'application/octet-stream' }) }
        catch { await route.abort() }
      } else if (route.request().url() === url) await route.fulfill({ body: fixture, contentType: 'text/html' })
      else await route.abort()
    })
    await page.goto(url)
    await page.evaluate(() => { globalThis.CKEDITOR_BASEPATH = 'https://msp.aliyun.com/ckeditor/' })
    await page.addScriptTag({ path: resolve(root, 'ckeditor.js') })
    await page.addScriptTag({ content: helper.outputFiles[0].text })
    await page.evaluate(async () => {
      globalThis.confirm = () => true
      const CKEDITOR = globalThis.CKEDITOR
      await Promise.all(['editor3', 'editor4'].map(id => new Promise(resolve => {
        CKEDITOR.replace(id, {
          customConfig: '', language: 'en', versionCheck: false,
          allowedContent: true, extraPlugins: 'uploadimage', uploadUrl: '/upload',
          on: { instanceReady: resolve },
        })
      })))
      await Promise.all(['editor3', 'editor4'].map(id => new Promise(resolve => {
        CKEDITOR.instances[id].setData(`<p>${id === 'editor3' ? '原产品详情' : '保留服务说明'}</p>`, { callback: resolve })
      })))
      globalThis.initialEditable = CKEDITOR.instances.editor3.editable().$
      globalThis.initialHtml = CKEDITOR.instances.editor3.getData()
      globalThis.makeArticle = html => ({ title: '文章', html, portableMarkdown: '文章' })
    })
    await run(page)
    checks++
    console.log(`PASS ${name}`)
  } finally { await page.close() }
}

try {
  await check('阿里云真实 CKEditor 替换正文时保持 iframe 与其他字段', async page => {
    const result = await page.evaluate(async () => {
      const { CKEDITOR, DraftFerryTest, document } = globalThis
      const other = document.querySelector('#other')
      other.focus()
      other.setSelectionRange(1, 3)
      let error = null
      try {
        await DraftFerryTest.injectPlatformArticle(document, globalThis.makeArticle('<h2>新详情</h2><p>完整正文</p><table><tbody><tr><td>表格</td></tr></tbody></table>'))
      } catch (failure) { error = failure.message }
      return {
        error, html: CKEDITOR.instances.editor3.getData(), otherHtml: CKEDITOR.instances.editor4.getData(),
        sameEditable: CKEDITOR.instances.editor3.editable().$ === globalThis.initialEditable,
        focus: document.activeElement.id, selection: [other.selectionStart, other.selectionEnd],
        locked: document.querySelectorAll('[aria-busy="true"]').length,
      }
    })
    assert.equal(result.error, null)
    assert.match(result.html, /完整正文/)
    assert.match(result.html, /<table>/)
    assert.doesNotMatch(result.html, /原产品详情/)
    assert.match(result.otherHtml, /保留服务说明/)
    assert.equal(result.sameEditable, true)
    assert.equal(result.focus, 'other')
    assert.deepEqual(result.selection, [1, 3])
    assert.equal(result.locked, 0)
  })

  await check('阿里云原生图片上传期间锁住正文且保留其他字段操作', async page => {
    const respond = await beginImageUpload(page)
    try {
      const body = page.frameLocator('#cke_editor3 iframe').locator('body')
      await body.click()
      await page.keyboard.type('BLOCKED')
      assert.equal(await body.locator('text=BLOCKED').count(), 0)
      await page.locator('#other').fill('导入时编辑其他字段')
      respond({ contentType: 'application/json', body: JSON.stringify({ uploaded: 1, fileName: 'image.png', url: 'https://msp.aliyun.com/uploaded.png' }) })
      assert.deepEqual(await page.evaluate(() => globalThis.operation), { ok: true })
      const result = await page.evaluate(() => ({
        html: globalThis.CKEDITOR.instances.editor3.getData(),
        other: globalThis.document.querySelector('#other').value,
        otherHtml: globalThis.CKEDITOR.instances.editor4.getData(),
        sameEditable: globalThis.CKEDITOR.instances.editor3.editable().$ === globalThis.initialEditable,
        busy: globalThis.CKEDITOR.instances.editor3.editable().$.hasAttribute('aria-busy'),
      }))
      assert.match(result.html, /https:\/\/msp.aliyun.com\/uploaded.png/)
      assert.match(result.html, /图片前[\s\S]*<img[\s\S]*图片后/)
      assert.doesNotMatch(result.html, /原产品详情|BLOCKED|data:image|blob:/)
      assert.equal(result.other, '导入时编辑其他字段')
      assert.match(result.otherHtml, /保留服务说明/)
      assert.equal(result.sameEditable, true)
      assert.equal(result.busy, false)
    } finally { respond({ status: 500, body: '' }) }
  })

  for (const cancel of [false, true]) {
    await check(`阿里云${cancel ? '暂停上传' : '上传失败'}会恢复原文并解除正文锁定`, async page => {
      const respond = await beginImageUpload(page)
      try {
        if (cancel) await page.evaluate(() => globalThis.controller.abort())
        else respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ uploaded: 0, error: { message: '测试上传失败' } }) })
        const result = await page.evaluate(async () => ({
          outcome: await globalThis.operation,
          html: globalThis.CKEDITOR.instances.editor3.getData(),
          original: globalThis.initialHtml,
          busy: globalThis.CKEDITOR.instances.editor3.editable().$.hasAttribute('aria-busy'),
          wrapperBusy: globalThis.CKEDITOR.instances.editor3.container.$.hasAttribute('aria-busy'),
        }))
        assert.equal(result.outcome.ok, false)
        // CKEditor does not emit fileUploadResponse for every HTTP failure;
        // both explicit failure and the bounded response timeout must roll back.
        assert.match(result.outcome.message, cancel ? /已停止导入/ : /图片上传/)
        assert.equal(result.html, result.original)
        assert.equal(result.busy, false)
        assert.equal(result.wrapperBusy, false)
        const body = page.frameLocator('#cke_editor3 iframe').locator('body')
        // A native upload-error toast may overlay the text; keyboard editing
        // still needs to work after our lock has been released.
        await body.focus()
        await page.keyboard.type('UNLOCKED')
        assert.match(await body.innerText(), /UNLOCKED/)
      } finally { respond({ status: 500, body: '' }) }
    })
  }

  await check('阿里云上传期间切页不会覆盖新页面正文', async page => {
    const respond = await beginImageUpload(page)
    try {
      const result = await page.evaluate(async () => {
        globalThis.history.pushState({}, '', '?commodityId=69736')
        await new Promise(resolve => globalThis.CKEDITOR.instances.editor3.setData('<p>新页面人工编辑</p>', { callback: resolve }))
        globalThis.controller.abort()
        return { outcome: await globalThis.operation, html: globalThis.CKEDITOR.instances.editor3.getData() }
      })
      assert.equal(result.outcome.ok, false)
      assert.match(result.outcome.message, /页面或编辑器已切换/)
      assert.match(result.html, /新页面人工编辑/)
      assert.doesNotMatch(result.html, /原产品详情/)
    } finally { respond({ status: 500, body: '' }) }
  })
} finally { await browser.close() }
console.log(`Aliyun browser verification: ${checks} scenarios passed (real CKEditor 4.22.1; isolated Chrome)`)
