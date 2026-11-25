/* global window, document */
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = resolve(root, 'dist/folio.user.js')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const mermaidPkg = JSON.parse(
  await readFile(resolve(root, 'node_modules/mermaid/package.json'), 'utf8'),
)
const vendorMermaidPath = resolve(root, `dist/vendor/mermaid-${mermaidPkg.version}-tm.min.js`)

const bundleStat = await stat(bundlePath)
assert.ok(
  bundleStat.size < 480 * 1024,
  `dist/folio.user.js size ${bundleStat.size} bytes exceeds 480 KB limit`,
)
console.log(`PASS [0/4] dist/folio.user.js size check: ${bundleStat.size} bytes (< 480 KB)`)

const bundleCode = await readFile(bundlePath, 'utf8')
const vendorMermaidCode = await readFile(vendorMermaidPath, 'utf8')

// Verify userscript metadata & zero eval in dist/folio.user.js
assert.match(bundleCode, new RegExp(`@version\\s+${pkg.version.replace(/\./g, '\\.')}`))
assert.match(
  bundleCode,
  new RegExp(
    `@require\\s+https://acv\\.k-neco\\.com/tools/vendor/mermaid-${mermaidPkg.version.replace(/\./g, '\\.')}-tm\\.min\\.js`,
  ),
)
assert.match(bundleCode, /@updateURL\s+https:\/\/acv\.k-neco\.com\/tools\/folio\.user\.js/)
assert.match(bundleCode, /@downloadURL\s+https:\/\/acv\.k-neco\.com\/tools\/folio\.user\.js/)
assert.doesNotMatch(bundleCode, /\(0,\s*eval\)/)

const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:"
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Wrap vendor Mermaid inside a closure identical to Tampermonkey @require execution
const wrappedVendorScript = `(function(window, GM_info){\n${vendorMermaidCode}\n})(window, {});`

async function setupMockPage(context, url, html, extraRoutes) {
  const page = await context.newPage()
  const origin = new URL(url).origin
  await page.route('**/*', async (route) => {
    const reqUrl = route.request().url()
    if (reqUrl === `${origin}/__tm__/mermaid-tm.min.js`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: wrappedVendorScript,
      })
    }
    if (reqUrl === `${origin}/__tm__/folio.user.js`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: bundleCode,
      })
    }
    if (extraRoutes) {
      const handled = await extraRoutes(route, reqUrl)
      if (handled) return
    }
    if (reqUrl.startsWith(origin)) {
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Security-Policy': STRICT_CSP,
        },
        contentType: 'text/html; charset=utf-8',
        body: html,
      })
    }
    return route.abort()
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return { page, origin }
}

async function injectUserscript(page, origin, withMermaid = true) {
  if (withMermaid) {
    await page.addScriptTag({ url: `${origin}/__tm__/mermaid-tm.min.js` })
  }
  await page.addScriptTag({ url: `${origin}/__tm__/folio.user.js` })
}

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true })

try {
  // 1. SPA route mount / unmount test on Baijiahao under strict CSP
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const { page, origin } = await setupMockPage(
      context,
      'https://baijiahao.baidu.com/builder/rc/home',
      '<html><body><h1>Home</h1></body></html>',
    )
    await injectUserscript(page, origin)
    assert.equal(await page.locator('#rin-folio').count(), 0, 'must NOT mount on non-editor home page')

    await page.evaluate(() => {
      window.history.pushState({}, '', '/builder/rc/edit?type=news')
    })
    await page.locator('#rin-folio').waitFor({ state: 'attached', timeout: 3000 })
    assert.equal(await page.locator('#rin-folio').count(), 1, 'must auto-mount on SPA pushState')

    await page.evaluate(() => {
      window.history.pushState({}, '', '/builder/rc/home')
    })
    await page.locator('#rin-folio').waitFor({ state: 'detached', timeout: 3000 })
    assert.equal(await page.locator('#rin-folio').count(), 0, 'must auto-unmount on leaving edit route')
    await context.close()
    console.log('PASS [1/4] SPA pushState auto-mount & unmount under strict CSP')
  }

  // 2. Tencent Market React Fiber + wangEditor 3.x + strict-CSP @require Mermaid PNG + rollback + diagnostic
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const { page, origin } = await setupMockPage(
      context,
      'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET',
      `<html><body style="font-family:sans-serif;padding:24px">
        <div class="tea-form-item">
          <label>商品详情</label>
          <div class="w-e-text" contenteditable="true" style="width:600px;height:240px;border:1px solid #ccc"><p>原始商品详情</p></div>
        </div>
      </body></html>`,
      async (route, reqUrl) => {
        if (reqUrl.startsWith('https://console.cloud.tencent.com/u/')) {
          await route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from(TINY_PNG_B64, 'base64'),
          })
          return true
        }
        return false
      },
    )

    const cspErrors = []
    page.on('pageerror', (err) => cspErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') cspErrors.push(msg.text())
    })

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
        change() {
          window.__changeCount += 1
        },
        config: {
          customUploadImg(files, insert) {
            if (window.__failUpload) return Promise.reject(new Error('network down'))
            window.__uploads.push(files[0].name)
            insert(`https://console.cloud.tencent.com/u/${window.__uploads.length}.png`)
          },
        },
      }
      editorEl['__reactFiber$e2e'] = { return: { stateNode: { editor: wang } } }
    })

    await injectUserscript(page, origin)

    const host = page.locator('#rin-folio')
    await host.waitFor({ state: 'attached', timeout: 3000 })
    assert.equal(await host.locator('.toggle').textContent(), 'Folio')

    await host.locator('.toggle').click()
    await host.locator('.card').waitFor({ state: 'visible' })
    assert.equal(await host.locator('.platform-name').textContent(), '腾讯云市场')

    await page.keyboard.press('Escape')
    await host.locator('.card').waitFor({ state: 'hidden' })
    await host.locator('.toggle').click()

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
      'flowchart LR',
      '  A["GoCardless<br/>客户/银行账户/授权"] —>|"同步"| B[成集云/中台] style A fill:#F2994A,stroke:#333,color:#fff',
      '~~~',
    ].join('\n')

    const fileInput = host.locator('input[type="file"]')
    await fileInput.setInputFiles([
      { name: 'demo.md', mimeType: 'text/markdown', buffer: Buffer.from(mdContent, 'utf8') },
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
    ])
    await fileInput.setInputFiles([
      { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
    ])
    await host.locator('button[aria-label="移除 b.png"]').click()
    assert.equal(await host.locator('.tags .tag').count(), 2)

    await host.locator('.go').click()
    await host.locator('.status.ok').waitFor({ state: 'visible', timeout: 15000 })
    assert.deepEqual(cspErrors, [], `unexpected CSP/page errors: ${cspErrors.join('; ')}`)

    const editorHtml = await page.locator('.w-e-text').innerHTML()
    assert.match(editorHtml, /console\.cloud\.tencent\.com\/u\/1\.png/)
    assert.match(editorHtml, /console\.cloud\.tencent\.com\/u\/2\.png/)
    assert.match(editorHtml, /<code>!\[ignored\]\(nope\.png\)<\/code>/)

    // Trigger failure & verify rollback + diagnostic
    await page.evaluate(() => {
      window.__failUpload = true
    })
    await host.locator('.toggle').click()
    await host.locator('.card').waitFor({ state: 'visible' })
    await fileInput.setInputFiles([
      { name: 'fail.md', mimeType: 'text/markdown', buffer: Buffer.from('# Fail\n\n![x](a.png)', 'utf8') },
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
    ])
    await host.locator('.go').click()
    await host.locator('.status.error').waitFor({ state: 'visible', timeout: 5000 })
    await host.locator('.diag').waitFor({ state: 'visible' })
    assert.equal(await page.locator('.w-e-text').innerHTML(), editorHtml, 'must preserve previous content on error')

    await context.close()
    console.log('PASS [2/4] Tencent Market + strict-CSP @require Mermaid PNG + rollback')
  }

  // 3. WeChat MP: strict-CSP Mermaid data:image/png export + unlabelled/dirty syntax + editorial theme + error feedback + XSS blocked
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const { page, origin } = await setupMockPage(
      context,
      'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2',
      `<html><body>
        <input id="title" placeholder="请输入标题" />
        <div class="ProseMirror" contenteditable="true">从这里开始写正文</div>
      </body></html>`,
    )
    const cspErrors = []
    page.on('pageerror', (err) => cspErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') cspErrors.push(msg.text())
    })

    await page.evaluate(() => {
      window.__mpContent = ''
      window.__MP_Editor_JSAPI__ = {
        invoke({ apiName, apiParam, sucCb }) {
          if (apiName === 'mp_editor_set_content') {
            window.__mpContent = apiParam.content
            document.querySelector('.ProseMirror').innerHTML = apiParam.content
            sucCb()
          }
        },
      }
    })
    await injectUserscript(page, origin)

    const host = page.locator('#rin-folio')
    await host.waitFor({ state: 'attached', timeout: 3000 })
    await host.locator('.toggle').click()
    await host.locator('.paste-toggle').click()
    await host.locator('.paste-input').fill(
      [
        '# 微信文章标题',
        '',
        '## 架构亮点',
        '',
        '使用 `prepareWechatHtml` 排版。',
        '',
        '<script>alert("xss")</script>',
        '',
        '```',
        'flowchart LR',
        '  A["GoCardless<br/>客户/银行账户/授权"] —>|"同步"| B["成集云平台"]',
        '  B ——>|"创建/审核"| C[金蝶云星空/客户档案] style A fill:#F2994A,stroke:#333,color:#fff style C fill:#27AE60,stroke:#333,color:#fff',
        '```',
        '',
        '```ts',
        'const count: number = 42',
        '```',
        '',
        '| 阶段 | GoCardless 对象 | 金蝶目标单据 |',
        '| :--- | :--- | :--- |',
        '| 签约 | `Mandate` | 客户档案 |',
        '| 扣款 | `Payment` | 收款单 |',
      ].join('\n'),
    )

    await host.locator('.go').click()
    await host.locator('.status.ok').waitFor({ state: 'visible', timeout: 15000 })
    assert.deepEqual(cspErrors, [], `unexpected CSP/page errors: ${cspErrors.join('; ')}`)

    assert.equal(await page.locator('#title').inputValue(), '微信文章标题')
    const mpHtml = await page.evaluate(() => window.__mpContent)
    assert.doesNotMatch(mpHtml, /<script/i)
    assert.match(mpHtml, /border-left: 3px solid rgb\(180, 83, 9\)/)
    assert.match(mpHtml, /<code style="[^"]*background: rgb\(243, 244, 246\)/)
    assert.match(mpHtml, /<span[^>]*style="color: rgb\(207, 34, 46\);?"[^>]*>const<\/span>/)
    assert.match(mpHtml, /<img[^>]+src="data:image\/png;base64,[A-Za-z0-9+/=]{100,}"/)
    assert.match(
      mpHtml,
      /<section style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 22px 0;"><table style="[^"]*table-layout: auto;[^"]*">/,
    )
    assert.match(mpHtml, /<p[^>]*><br><\/p>$/)

    // Verify explicit warning in panel completion status when a Mermaid block has invalid syntax
    await host.locator('.toggle').click()
    await host.locator('.card').waitFor({ state: 'visible' })
    await host.locator('.paste-toggle').click()
    await host.locator('.paste-input').fill('# 坏图测试\n\n```mermaid\nflowchart LR\n  A --> --> -->\n```')
    await host.locator('.go').click()
    const warnStatus = host.locator('.status.warn')
    await warnStatus.waitFor({ state: 'visible', timeout: 15000 })
    const warnText = await warnStatus.textContent()
    assert.match(warnText ?? '', /第 1 张图表语法错误/)

    await context.close()
    console.log(
      'PASS [3/4] WeChat MP strict-CSP Mermaid PNG + paper editorial theme + explicit syntax error warning',
    )
  }

  // 4. Zhihu: Path A lossless Markdown + image upload + modal confirmation
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const { page, origin } = await setupMockPage(
      context,
      'https://zhuanlan.zhihu.com/write',
      `<html><body>
        <textarea placeholder="请输入标题（最多 100 个字）"></textarea>
        <div class="public-DraftEditor-content" contenteditable="true"></div>
      </body></html>`,
      async (route, reqUrl) => {
        if (reqUrl === 'https://zhuanlan.zhihu.com/api/uploaded_images') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ src: 'https://pic.zhihu.test/uploaded-1.png' }),
          })
          return true
        }
        return false
      },
    )
    await page.evaluate(() => {
      const editor = document.querySelector('.public-DraftEditor-content')
      window.__zhihuMarkdown = ''
      window.__zhihuConfirmed = false
      editor.addEventListener('paste', (e) => {
        window.__zhihuMarkdown = e.clipboardData.getData('text/plain')
        const modal = document.createElement('div')
        modal.setAttribute('role', 'dialog')
        const parseBtn = document.createElement('button')
        parseBtn.textContent = '确认并解析'
        parseBtn.onclick = () => {
          const confirmBtn = document.createElement('button')
          confirmBtn.textContent = '确认'
          confirmBtn.onclick = () => {
            window.__zhihuConfirmed = true
            modal.remove()
          }
          modal.append(confirmBtn)
        }
        modal.append(parseBtn)
        document.body.append(modal)
      })
    })
    await injectUserscript(page, origin)

    const host = page.locator('#rin-folio')
    await host.waitFor({ state: 'attached', timeout: 3000 })
    await host.locator('.toggle').click()

    const zhihuMd = [
      '# 知乎无损标题',
      '',
      '![实图](a.png)',
      '',
      '```ts',
      'const untouched = "![fake](nope.png)"',
      '```',
    ].join('\n')

    await host.locator('input[type="file"]').setInputFiles([
      { name: 'zhihu.md', mimeType: 'text/markdown', buffer: Buffer.from(zhihuMd, 'utf8') },
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_B64, 'base64') },
    ])
    await host.locator('.go').click()
    await host.locator('.status.ok').waitFor({ state: 'visible', timeout: 5000 })

    assert.equal(await page.locator('textarea[placeholder*="标题"]').inputValue(), '知乎无损标题')
    assert.equal(await page.evaluate(() => window.__zhihuConfirmed), true)
    const receivedMd = await page.evaluate(() => window.__zhihuMarkdown)
    assert.match(receivedMd, /!\[实图\]\(https:\/\/pic\.zhihu\.test\/uploaded-1\.png\)/)
    assert.match(receivedMd, /const untouched = "!\[fake\]\(nope\.png\)"/)

    await context.close()
    console.log('PASS [4/4] Zhihu lossless Markdown + image upload + dialog confirm')
  }
} finally {
  await browser.close()
}
