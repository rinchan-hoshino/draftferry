import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { describe, it } from 'vitest'
import { mergePendingFiles } from '../src/panel.tsx'
import aliyun from '../src/platforms/aliyun.ts'
import { findLiveEditor } from '../src/platforms/baijiahao.ts'
import { detectPlatform, PLATFORMS } from '../src/platforms/index.ts'
import sohu, { getSohuQuill, prepareSohuHtml } from '../src/platforms/sohu.ts'
import tencent, { findWangEditor } from '../src/platforms/tencent.ts'
import { prepareWechatHtml } from '../src/platforms/wechat.ts'
import type { PlatformId } from '../src/types.ts'

const CASES: Record<PlatformId, [string, string]> = {
  zhihu: ['https://zhuanlan.zhihu.com/write', 'https://zhuanlan.zhihu.com/p/12345'],
  wechat: [
    'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit',
    'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_list',
  ],
  oschina: ['https://my.oschina.net/rin/blog/ai-write', 'https://my.oschina.net/rin/blog/123'],
  baijiahao: [
    'https://baijiahao.baidu.com/builder/rc/edit?type=news',
    'https://baijiahao.baidu.com/builder/rc/home',
  ],
  toutiao: [
    'https://mp.toutiao.com/profile_v4/graphic/publish',
    'https://mp.toutiao.com/profile_v4/graphic/list',
  ],
  sohu: [
    'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
    'https://mp.sohu.com/mpfe/v4/contentManagement/news/list',
  ],
  'aliyun-market': [
    'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=9',
    'https://msp.aliyun.com/msp/commodity/list/~/publish/basic',
  ],
  'tencent-market': [
    'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET',
    'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=OTHER',
  ],
}

describe('platforms', () => {
  it('every platform matches its editor route and rejects non-editor pages', () => {
    assert.deepEqual(
      PLATFORMS.map((p) => p.id).sort(),
      Object.keys(CASES).sort(),
    )
    for (const [id, [yes, no]] of Object.entries(CASES) as Array<[PlatformId, [string, string]]>) {
      const platform = PLATFORMS.find((p) => p.id === id)!
      assert.equal(platform.match(new URL(yes)), true, `${id} should match ${yes}`)
      assert.equal(platform.match(new URL(no)), false, `${id} should reject ${no}`)
      assert.equal(detectPlatform(yes)?.id, id)
      assert.equal(detectPlatform(no), null)
    }
  })

  it('wechat applies gold border headings, syntax highlighting, and trailing editable paragraph', () => {
    const { window } = new JSDOM('')
    const out = prepareWechatHtml(
      window.document,
      '<h2>标题</h2><pre><code class="language-ts">const x: number = 42</code></pre><table><tr><td>a</td></tr></table>',
    )
    assert.match(out, /border-left: 4px solid rgb\(216, 165, 34\)/)
    assert.match(out, /<span style="color: #[0-9a-f]+">const<\/span>/)
    assert.match(out, /<\/table><p[^>]*><br><\/p>$/)
  })

  it('sohu downgrades H2/H3 when no H1 exists and strips whitespace text nodes inside tables', () => {
    const { window } = new JSDOM('')
    const out = prepareSohuHtml(
      window.document,
      '<h2>节一</h2><h3>节二</h3><h4>节三</h4><table>\n  <tbody>\n    <tr>\n      <td>cell</td>\n    </tr>\n  </tbody>\n</table>',
    )
    assert.match(out, /<h1>节一<\/h1><h2>节二<\/h2><p><strong>节三<\/strong><\/p>/)
    assert.doesNotMatch(out, /<table>\s+<tbody>/)
    assert.match(out, /<tbody><tr><td>cell<\/td><\/tr><\/tbody>/)
  })

  it('sohu discovers Proxy-wrapped Quill instance even when getOwnPropertyDescriptor returns undefined', () => {
    const { window } = new JSDOM(
      '<div id="host"><div class="ql-editor" contenteditable="true">old</div></div>',
    )
    const editor = window.document.querySelector('.ql-editor')!
    const rawQuill = {
      root: editor,
      clipboard: { dangerouslyPasteHTML: () => {} },
      getContents: () => ({ ops: [{ insert: 'old\n' }] }),
      getLength: () => 4,
      setContents: () => {},
    }
    const proxiedQuill = new Proxy(rawQuill, {
      getOwnPropertyDescriptor: () => undefined,
    })
    const host = window.document.querySelector('#host') as unknown as Record<string, unknown>
    host.__vue__ = { _data: { quill: proxiedQuill } }

    const api = getSohuQuill(editor)
    assert.ok(api, 'should discover proxied Quill via direct property reads')
    assert.equal(api.quill, proxiedQuill)
  })

  it('sohu rolls back Delta when write fails read-back', () => {
    const { window } = new JSDOM(
      '<div id="host"><div class="ql-editor" contenteditable="true">old content</div></div>',
    )
    const editor = window.document.querySelector('.ql-editor')!
    let restored: unknown = null
    const quill = {
      root: editor,
      clipboard: {
        dangerouslyPasteHTML: () => {
          editor.textContent = ''
        },
      },
      getContents: () => ({ ops: [{ insert: 'old content\n' }] }),
      getLength: () => 12,
      setContents: (delta: unknown) => {
        restored = delta
      },
    }
    ;(window.document.querySelector('#host') as unknown as Record<string, unknown>).__vue__ = {
      _data: { quill },
    }
    const adapter = sohu.findEditor(
      window.document,
      window as unknown as Window,
    )
    assert.throws(
      () => adapter.setHTML('<p>这是一段很长的新文章正文内容</p>'),
      /读回长度不对/,
    )
    assert.deepEqual(restored, { ops: [{ insert: 'old content\n' }] })
  })

  it('tencent discovers wangEditor through React 17 Fiber, deduplicates uploads, and triggers change()', async () => {
    const { window } = new JSDOM(
      '<div class="form-item"><label>商品详情</label><div class="w-e-text" contenteditable="true"><p>old</p></div></div>',
      {
        url: 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET',
      },
    )
    const editorEl = window.document.querySelector('.w-e-text')!
    let uploadCalls = 0
    let changeCalls = 0
    const wang = {
      $textElem: { elems: [editorEl] },
      txt: {
        html(val?: string) {
          if (val !== undefined) editorEl.innerHTML = val
          return editorEl.innerHTML
        },
      },
      change() {
        changeCalls += 1
      },
      config: {
        customUploadImg(_files: File[], insert: (url: string) => void) {
          uploadCalls += 1
          insert(`https://cdn.example.com/img-${uploadCalls}.png`)
        },
      },
    }
    ;(editorEl as unknown as Record<string, unknown>)['__reactFiber$abc123'] = {
      return: { stateNode: { editor: wang } },
    }

    assert.equal(findWangEditor(editorEl), wang)
    const adapter = tencent.findEditor(window.document, window as unknown as Window)
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const progress: string[] = []
    await adapter.setHTML(`<p>Hello</p><img src="${dataUrl}"><img src="${dataUrl}">`, {
      onProgress: (msg) => progress.push(msg),
    })
    assert.equal(uploadCalls, 1, 'identical images should be uploaded only once')
    assert.equal(changeCalls, 1, 'wangEditor 3.x change() should be triggered')
    assert.match(editorEl.innerHTML, /cdn\.example\.com\/img-1\.png/)
    assert.ok(progress.some((m) => m.includes('上传图片 1/1')))
  })

  it('aliyun aborts loaders and restores previous data via setData when upload fails', async () => {
    const { window } = new JSDOM(
      '<div class="next-form-item"><label>产品详情</label><div class="cke cke_editor_detail1"></div></div>',
      { url: 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=7' },
    )
    let currentData = '<p>original detail</p>'
    let aborted = false
    let listeners: Array<(event: unknown) => void> = []
    const ckEditor = {
      mode: 'wysiwyg',
      readOnly: false,
      editable: () => ({}),
      createRange: () => ({ selectNodeContents() {} }),
      getSelection: () => ({ selectRanges() {} }),
      getData: () => currentData,
      setData(html: string, opts?: { callback?: () => void }) {
        currentData = html
        opts?.callback?.()
      },
      on(name: string, fn: (event: unknown) => void) {
        if (name === 'fileUploadResponse') listeners.push(fn)
      },
      removeListener(_name: string, fn: (event: unknown) => void) {
        listeners = listeners.filter((f) => f !== fn)
      },
      uploadRepository: {
        loaders: {
          1: {
            abort() {
              aborted = true
            },
          },
        },
      },
      fire(name: string) {
        if (name === 'paste') {
          currentData = '<p>partial</p>'
          for (const fn of [...listeners]) {
            fn({ data: { fileLoader: { xhr: { status: 500 } } } })
          }
        }
      },
    }
    ;(window as unknown as Record<string, unknown>).CKEDITOR = {
      instances: { detail1: ckEditor },
    }

    const adapter = aliyun.findEditor(window.document, window as unknown as Window)
    await assert.rejects(
      async () => adapter.setHTML('<p>New</p><img src="data:image/png;base64,iVBORw0KGgo=">'),
      /HTTP 500/,
    )
    assert.equal(aborted, true, 'upload loader should be aborted')
    assert.equal(currentData, '<p>original detail</p>', 'previous HTML should be restored')
  })

  it('baijiahao selects highest-numbered connected UEditor instance', () => {
    const disconnected = {
      body: { isConnected: false },
      iframe: { isConnected: false },
      getContent: () => '',
      setContent: () => {},
    }
    const connected = {
      body: { isConnected: true },
      iframe: { isConnected: true },
      getContent: () => '',
      setContent: () => {},
    }
    const fakeWin = {
      UE_V2: {
        instants: { ueditorInstant0: connected, ueditorInstant1: disconnected },
      },
    } as unknown as Window
    assert.equal(findLiveEditor(fakeWin), connected)
  })

  it('mergePendingFiles replaces md file and appends deduplicated images', () => {
    const f = (name: string) => ({ name }) as File
    let list = mergePendingFiles([], [f('a.md'), f('pic1.png')])
    assert.deepEqual(
      list.map((x) => x.name),
      ['a.md', 'pic1.png'],
    )
    list = mergePendingFiles(list, [f('PIC1.PNG'), f('pic2.jpg')])
    assert.deepEqual(
      list.map((x) => x.name),
      ['a.md', 'PIC1.PNG', 'pic2.jpg'],
    )
    list = mergePendingFiles(list, [f('b.markdown')])
    assert.deepEqual(
      list.map((x) => x.name),
      ['b.markdown', 'PIC1.PNG', 'pic2.jpg'],
    )
  })
})
