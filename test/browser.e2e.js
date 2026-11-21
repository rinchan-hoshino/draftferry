/* global window, document */
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundleCode = await readFile(resolve(root, 'dist/draftferry.user.js'), 'utf8')
const PREVIEW_PATH = '/Users/rin/.gemini/antigravity-cli/brain/53ada6b6-a646-4cd9-b97c-3174f2b1b6ff/scratch/draftferry_ui_preview.png'

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function setupMockPage(context, url, html) {
  const page = await context.newPage()
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(new URL(url).origin)) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    }
    return route.abort()
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return page
}

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true })

try {
  // 1. SPA route mount / unmount test on Baijiahao
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await setupMockPage(context, 'https://baijiahao.baidu.com/builder/rc/home', '<html><body><h1>Home</h1></body></html>')
    await page.addScriptTag({ content: bundleCode })
    assert.equal(await page.locator('#rin-draftferry').count(), 0, 'must NOT mount on non-editor home page')

    await page.evaluate(() => { window.history.pushState({}, '', '/builder/rc/edit?type=news') })
    await page.locator('#rin-draftferry').waitFor({ state: 'attached', timeout: 3000 })
    assert.equal(await page.locator('#rin-draftferry').count(), 1, 'must auto-mount on SPA pushState to edit route')

    await page.evaluate(() => { window.history.pushState({}, '', '/builder/rc/home') })
    await page.locator('#rin-draftferry').waitFor({ state: 'detached', timeout: 3000 })
    assert.equal(await page.locator('#rin-draftferry').count(), 0, 'must auto-unmount when leaving edit route')
    await context.close()
    console.log('PASS [1/5] SPA pushState auto-mount & unmount')
  }

  // 2 & 3. Tencent Market React Fiber + wangEditor 3.x + file append/delete + real Mermaid PNG + upload rollback
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await setupMockPage(
      context,
      'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET',
      `<html><body style="font-family:sans-serif;padding:24px">
        <div class="tea-form-item">
          <label>商品详情</label>
          <div class="w-e-text" contenteditable="true" style="width:600px;height:240px;border:1px solid #ccc"><p>原始商品详情</p></div>
        </div>
      </body></html>`,
    )
    await page.evaluate(() => {
      const editorEl = document.querySelector('.w-e-text')
      window.__uploads = []
      window.__changeCount = 0
      window.__failUpload = false
      const wang = {
        $textElem: { elems: [editorEl] },
        txt: {
          html(val) {
            if (val !== undefined) editorEl.innerHTML = val
            return editorEl.innerHTML
          },
        },
        change() { window.__changeCount += 1 },
        config: {
          customUploadImg(files, insert) {
            if (window.__failUpload) return Promise.reject(new Error('network down'))
            window.__uploads.push(files[0].name)
            insert(`https://cdn.tencent.test/u/${window.__uploads.length}.png`)
          },
        },
      }
      editorEl['__reactFiber$e2e'] = { return: { stateNode: { editor: wang } } }
    })
    await page.addScriptTag({ content: bundleCode })

    const host = page.locator('#rin-draftferry')
    await host.waitFor({ state: 'attached', timeout: 3000 })

    // Open panel via capsule toggle
    await host.locator('.toggle').click()
    await host.locator('.card').waitFor({ state: 'visible' })
    assert.equal(await host.locator('.platform-name').textContent(), '腾讯云市场')

    // Test Esc close and reopen
    await page.keyboard.press('Escape')
    await host.locator('.card').waitFor({ state: 'hidden' })
    await host.locator('.toggle').click()

    // Append files in two batches + remove one
    const mdContent = [
      '# 腾讯云测试稿',
      '',
      '行内代码 `![ignored](nope.png)` 不该被改写。',
      '',
      '![图一](a.png)',
      '',
      '![重复图](a.png)',
      '',
      '~~~mermaid',
      'graph LR',
      '  A[开始] --> B[完成]',
      '~~~',
    ].join('\n')

    const fileInput = host.locator('input[type="file"]')
    await fileInput.setInputFiles([
      { name: 'demo.md', mimeType: 'text/markdown', buffer: Buffer.from(mdContent, 'utf8') },
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
    ])
    await fileInput.setInputFiles([
      { name: 'extra.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
    ])
    assert.equal(await host.locator('.tag').count(), 3, 'should merge second batch instead of replacing')
    await host.locator('.tag').nth(2).locator('.tag-del').click()
    assert.equal(await host.locator('.tag').count(), 2, 'single tag removal should work')

    // Run import (includes real Mermaid SVG -> 2x PNG rendering!)
    await host.locator('.go').click()
    await page.waitForFunction(() => window.__changeCount === 1, { timeout: 15000 })

    const tencentResult = await page.evaluate(() => ({
      html: document.querySelector('.w-e-text').innerHTML,
      uploads: window.__uploads,
      changes: window.__changeCount,
    }))
    assert.equal(tencentResult.uploads.length, 2, 'should upload 1 deduped local image + 1 mermaid PNG')
    assert.equal(tencentResult.changes, 1)
    assert.match(tencentResult.html, /cdn\.tencent\.test\/u\/1\.png/)
    assert.match(tencentResult.html, /cdn\.tencent\.test\/u\/2\.png/)
    assert.match(tencentResult.html, /!\[ignored\]\(nope\.png\)/)
    assert.doesNotMatch(tencentResult.html, /缺图/)
    console.log('PASS [2/5] Tencent React Fiber + wangEditor + real Mermaid 2x PNG + file merge')

    // Auto-collapse after 1.5s, then test upload failure keeps original content & shows diagnostic button
    await host.locator('.card').waitFor({ state: 'hidden', timeout: 4000 })
    await page.evaluate(() => { window.__failUpload = true })
    const beforeFailHtml = await page.evaluate(() => document.querySelector('.w-e-text').innerHTML)
    await host.locator('.toggle').click()
    await fileInput.setInputFiles([
      { name: 'fail.md', mimeType: 'text/markdown', buffer: Buffer.from('# Fail\n\n![x](a.png)\n', 'utf8') },
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
    ])
    await host.locator('.go').click()
    await host.locator('.diag').waitFor({ state: 'visible', timeout: 5000 })
    const afterFailHtml = await page.evaluate(() => document.querySelector('.w-e-text').innerHTML)
    assert.equal(afterFailHtml, beforeFailHtml, 'original editor HTML must remain untouched on upload failure')
    await context.close()
    console.log('PASS [3/5] Tencent upload failure preserves original content & reveals diagnostic button')
  }

  // 4. Sohu Proxy-wrapped Vue + Quill + table whitespace cleanup + Delta rollback
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await setupMockPage(
      context,
      'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
      `<html><body style="font-family:sans-serif;padding:24px">
        <input placeholder="请输入标题" style="width:400px" />
        <div id="vue-root"><div class="ql-editor" contenteditable="true" style="width:600px;height:200px">旧正文</div></div>
      </body></html>`,
    )
    await page.evaluate(() => {
      const editor = document.querySelector('.ql-editor')
      window.__pasted = ''
      window.__restored = null
      window.__breakWrite = false
      const rawQuill = {
        root: editor,
        clipboard: {
          dangerouslyPasteHTML(html) {
            window.__pasted = html
            editor.innerHTML = window.__breakWrite ? '' : html
          },
        },
        getContents: () => ({ ops: [{ insert: '旧正文\n' }] }),
        getLength: () => 4,
        setContents(delta) { window.__restored = delta },
      }
      const proxied = new Proxy(rawQuill, { getOwnPropertyDescriptor: () => undefined })
      document.querySelector('#vue-root').__vue__ = { _data: { quill: proxied } }
    })
    await page.addScriptTag({ content: bundleCode })

    const host = page.locator('#rin-draftferry')
    await host.locator('.toggle').click()
    await host.locator('.paste-toggle').click()
    await host.locator('.paste-input').fill('# 搜狐测试标题\n\n## 章节一\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n')
    await host.locator('.go').click()
    await page.waitForFunction(() => document.querySelector('input').value === '搜狐测试标题', { timeout: 5000 })

    const sohuPasted = await page.evaluate(() => window.__pasted)
    assert.match(sohuPasted, /<h1>章节一<\/h1>/, 'H2 should downgrade to H1 when body has no H1')
    assert.doesNotMatch(sohuPasted, /<table>\s+<thead>/, 'table whitespace nodes should be stripped')

    // Test Delta rollback on read-back failure
    await host.locator('.card').waitFor({ state: 'hidden', timeout: 4000 })
    await page.evaluate(() => { window.__breakWrite = true })
    await host.locator('.toggle').click()
    await host.locator('.paste-toggle').click()
    await host.locator('.paste-input').fill('# 失败回滚\n\n这是一段会被模拟写入丢失的长正文内容。')
    await host.locator('.go').click()
    await host.locator('.diag').waitFor({ state: 'visible', timeout: 5000 })
    const restored = await page.evaluate(() => window.__restored)
    assert.deepEqual(restored, { ops: [{ insert: '旧正文\n' }] }, 'Delta snapshot must be restored on failure')
    await context.close()
    console.log('PASS [4/5] Sohu Proxy-wrapped Vue+Quill injection & Delta rollback')
  }

  // 5. Render 2x2 UI Preview (Light Collapsed, Light Expanded, Dark Collapsed, Dark Expanded)
  {
    await mkdir(dirname(PREVIEW_PATH), { recursive: true })
    const shots = []
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: 420, height: 470 },
        deviceScaleFactor: 2,
        colorScheme: scheme,
      })
      const bg = scheme === 'light' ? '#f4f5f7' : '#141518'
      const cardBg = scheme === 'light' ? '#ffffff' : '#1c1d21'
      const fg = scheme === 'light' ? '#2c3038' : '#d5d8e0'
      const border = scheme === 'light' ? '#e5e7eb' : '#2a2c33'
      const page = await setupMockPage(
        context,
        'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2',
        `<html><body style="margin:0;background:${bg};color:${fg};font-family:-apple-system,PingFang SC,sans-serif;padding:24px;">
          <div style="background:${cardBg};border:1px solid ${border};border-radius:12px;padding:20px;height:420px;opacity:.65;">
            <div style="font-size:18px;font-weight:600;margin-bottom:14px;">微信公众号编辑器（${scheme === 'light' ? '浅色' : '深色'}）</div>
            <div style="height:10px;width:72%;background:${border};border-radius:5px;margin-bottom:10px;"></div>
            <div style="height:10px;width:90%;background:${border};border-radius:5px;margin-bottom:10px;"></div>
            <div style="height:10px;width:60%;background:${border};border-radius:5px;"></div>
          </div>
        </body></html>`,
      )
      await page.addScriptTag({ content: bundleCode })
      const host = page.locator('#rin-draftferry')
      await host.waitFor({ state: 'attached', timeout: 3000 })
      shots.push({ label: `${scheme === 'light' ? 'Light' : 'Dark'} · Collapsed`, buf: await page.screenshot() })

      await host.locator('.toggle').click()
      await host.locator('input[type="file"]').setInputFiles([
        { name: 'weekly-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Demo\n', 'utf8') },
        { name: 'architecture.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
        { name: 'benchmark.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
      ])
      shots.push({ label: `${scheme === 'light' ? 'Light' : 'Dark'} · Expanded`, buf: await page.screenshot() })
      await context.close()
    }

    // Composite 2x2 grid into single crisp preview PNG
    const compContext = await browser.newContext({ viewport: { width: 900, height: 1020 }, deviceScaleFactor: 2 })
    const compPage = await compContext.newPage()
    const imgsHtml = shots.map(({ label, buf }) => `
      <figure style="margin:0;display:flex;flex-direction:column;gap:8px">
        <figcaption style="font-size:13px;font-weight:600;color:#475569">${label}</figcaption>
        <img src="data:image/png;base64,${buf.toString('base64')}" style="width:420px;height:470px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.10);border:1px solid #e2e8f0" />
      </figure>`).join('')
    await compPage.setContent(`
      <html><body style="margin:0;padding:24px;background:#eef0f4;font-family:-apple-system,PingFang SC,sans-serif">
        <div style="display:grid;grid-template-columns:420px 420px;gap:20px">${imgsHtml}</div>
      </body></html>`)
    await compPage.screenshot({ path: PREVIEW_PATH, fullPage: true })
    await compContext.close()
    console.log(`PASS [5/5] UI preview saved to ${PREVIEW_PATH}`)
  }
} finally {
  await browser.close()
}
