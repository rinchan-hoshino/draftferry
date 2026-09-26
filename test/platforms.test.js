import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import {
  PLATFORM_IDS,
  detectPlatform,
  injectPlatformArticle,
} from '../src/platforms.js'

const article = {
  title: '测试标题',
  html: '<h2 style="font-size:22px">小标题</h2><p>正文</p><img alt="流程图" src="data:image/png;base64,eA==">',
  portableMarkdown: '## 小标题\n\n正文\n\n![流程图](data:image/png;base64,eA==)',
}

const zhihuArticle = {
  ...article,
  html: '<h2 style="font-size:22px">小标题</h2><p>正文</p><img alt="远程图片" src="https://example.com/image.png">',
  portableMarkdown: '## 小标题\n\n正文\n\n![远程图片](https://example.com/image.png)',
}

function dom(html, url) {
  return new JSDOM(html, { url })
}

function attachWangEditor(element) {
  const editor = {
    create() {}, destroy() {}, initSelection() {},
    $textElem: { elems: [element] },
    txt: { html(value) { if (value !== undefined) element.innerHTML = value; return element.innerHTML } },
    config: { customUploadImg(_files, insert) { insert('https://market.cloud.tencent.com/uploaded.png') } },
    uploadImg: { uploadImg() { this.insertImg('https://market.cloud.tencent.com/uploaded.png') } },
  }
  element.__reactFiber$fixture = { memoizedState: { memoizedState: editor } }
  return editor
}

function zhihuFixture(onParse) {
  const page = dom(`
    <textarea placeholder="请输入标题"></textarea>
    <div class="public-DraftEditor-content" contenteditable="true"></div>
  `, 'https://zhuanlan.zhihu.com/write')
  const { window } = page
  const editor = window.document.querySelector('[contenteditable="true"]')
  class FakeDataTransfer {
    #data = new Map()
    setData(type, value) { this.#data.set(type, value) }
    getData(type) { return this.#data.get(type) ?? '' }
  }
  class FakeClipboardEvent extends window.Event {
    constructor(type, init) {
      super(type, init)
      this.clipboardData = init.clipboardData
    }
  }
  window.DataTransfer = FakeDataTransfer
  window.ClipboardEvent = FakeClipboardEvent
  editor.addEventListener('paste', (event) => {
    editor.textContent = event.clipboardData.getData('text/plain')
    const dialog = window.document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const parse = window.document.createElement('button')
    parse.textContent = '确认并解析'
    parse.onclick = () => onParse({ window, editor, dialog, parse })
    dialog.append(parse)
    window.document.body.append(dialog)
  })
  window.document.execCommand = (command) => {
    if (command === 'undo') editor.innerHTML = ''
    return true
  }
  return { page, window, editor }
}

test('只注册已确认的八个平台', () => {
  assert.deepEqual(PLATFORM_IDS, [
    'zhihu',
    'wechat',
    'oschina',
    'baijiahao',
    'toutiao',
    'sohu',
    'aliyun-market',
    'tencent-market',
  ])
})

test('按当前页面 hostname 识别八个平台', () => {
  const cases = [
    ['https://zhuanlan.zhihu.com/write', 'zhihu'],
    ['https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit', 'wechat'],
    ['https://my.oschina.net/u/1/blog/ai-write', 'oschina'],
    ['https://baijiahao.baidu.com/builder/rc/edit?type=news', 'baijiahao'],
    ['https://mp.toutiao.com/profile_v4/graphic/publish', 'toutiao'],
    ['https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle', 'sohu'],
    ['https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=68862', 'aliyun-market'],
    ['https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET', 'tencent-market'],
  ]

  for (const [url, expected] of cases) {
    assert.equal(detectPlatform(new URL(url))?.id, expected, url)
  }
  assert.equal(detectPlatform(new URL('https://example.com/')), null)
})

test('后台首页不误判为编辑器，只在实测编辑路由激活', () => {
  const cases = [
    [
      'https://baijiahao.baidu.com/builder/rc/home',
      'https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1',
      'baijiahao',
    ],
    [
      'https://mp.toutiao.com/profile_v4/index',
      'https://mp.toutiao.com/profile_v4/graphic/publish',
      'toutiao',
    ],
    [
      'https://mp.sohu.com/mpfe/v4/contentManagement/news/list',
      'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1',
      'sohu',
    ],
  ]

  cases.push(
    [
      'https://mp.weixin.qq.com/cgi-bin/appmsg?action=list',
      'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit',
      'wechat',
    ],
    [
      'https://msp.aliyun.com/msp/commodity/list',
      'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=68862',
      'aliyun-market',
    ],
    [
      'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=OTHER',
      'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET',
      'tencent-market',
    ],
  )

  for (const [backgroundUrl, editorUrl, platformId] of cases) {
    assert.equal(detectPlatform(new URL(backgroundUrl)), null, backgroundUrl)
    assert.equal(detectPlatform(new URL(editorUrl))?.id, platformId, editorUrl)
    assert.equal(detectPlatform(new URL(`${editorUrl.split('?')[0]}/anything`)), null)
  }
})

test('阿里云市场只通过“产品详情”CKEditor 粘贴 HTML 和上传图片', async () => {
  const page = dom(`
    <input id="product-name" value="保留商品名称">
    <div class="next-form-item">
      <label class="next-form-item-label"><span aria-hidden="true">*</span> 产品详情：</label>
      <div class="next-form-item-control">
        <div class="cke_140 cke cke_editor_editor3"></div>
      </div>
    </div>
    <div class="next-form-item">
      <label class="next-form-item-label">服务说明：</label>
      <div class="next-form-item-control">
        <div class="cke_141 cke cke_editor_editor4"></div>
      </div>
    </div>
    <button id="save">保存</button><button id="publish">发布</button>
  `, 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=68862')
  let currentHtml = ''
  let clicks = 0
  let uploadResponse
  const editor = {
    getData: () => currentHtml,
    setData(html, options) {
      currentHtml = html
      options?.callback?.()
    },
    on(name, handler) {
      assert.equal(name, 'fileUploadResponse')
      uploadResponse = handler
    },
    removeListener(name, handler) {
      assert.equal(name, 'fileUploadResponse')
      if (uploadResponse === handler) uploadResponse = null
    },
    fire(name, data) {
      assert.equal(name, 'paste')
      assert.equal(data.type, 'html')
      currentHtml = data.dataValue.replace(
        'data:image/png;base64,eA==',
        'https://market.aliyun.com/uploaded.png',
      )
      uploadResponse({ data: { fileLoader: { xhr: { status: 200 } } } })
    },
    focus() {},
  }
  let unrelatedFires = 0
  page.window.CKEDITOR = {
    instances: {
      editor3: editor,
      editor4: {
        getData: () => '<p>保留其他编辑器</p>',
        setData() {},
        fire() { unrelatedFires += 1 },
      },
    },
  }
  page.window.document.querySelector('#save').onclick = () => { clicks += 1 }
  page.window.document.querySelector('#publish').onclick = () => { clicks += 1 }

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'aliyun-market')
  assert.equal(result.titleFilled, false)
  assert.equal(currentHtml.includes('https://market.aliyun.com/uploaded.png'), true)
  assert.equal(page.window.document.querySelector('#product-name').value, '保留商品名称')
  assert.equal(unrelatedFires, 0)
  assert.equal(clicks, 0)
})

test('阿里云市场通过页面主上下文取得 CKEditor 实例', async () => {
  const sandbox = dom('<main>油猴隔离上下文</main>', 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=68862')
  const page = dom(`
    <div class="acpn-form-item">
      <label><span>*</span> 产品详情：</label>
      <div class="cke cke_editor_editor3"></div>
    </div>
  `, 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=68862')
  let currentHtml = ''
  page.window.CKEDITOR = { instances: { editor3: {
    getData: () => currentHtml,
    setData(html, options) { currentHtml = html; options?.callback?.() },
    fire(_name, data) { currentHtml = data.dataValue },
    focus() {},
  } } }

  const result = await injectPlatformArticle(sandbox.window.document, {
    ...article,
    html: '<p>主上下文正文</p>',
  }, { pageWindow: page.window })

  assert.equal(result.platformId, 'aliyun-market')
  assert.equal(currentHtml, '<p>主上下文正文</p>')
})

test('腾讯云市场只向唯一的商品详情 wangEditor 写入 HTML', async () => {
  const page = dom(`
    <input id="product-name" value="保留商品名称">
    <div class="other-detail"><span>客户案例</span>
      <div class="w-e-text" contenteditable="true"></div>
    </div>
    <div class="market-detail"><span>商品详情 <i aria-hidden="true">*</i></span>
      <div class="w-e-text" contenteditable="true"></div>
    </div>
    <button id="save">保存</button><button id="publish">发布</button>
  `, 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET')
  const { window } = page
  const editor = window.document.querySelector('.market-detail .w-e-text')
  let clicks = 0
  attachWangEditor(editor)
  window.document.querySelector('#save').onclick = () => { clicks += 1 }
  window.document.querySelector('#publish').onclick = () => { clicks += 1 }

  const result = await injectPlatformArticle(window.document, article)

  assert.equal(result.platformId, 'tencent-market')
  assert.equal(result.titleFilled, false)
  assert.equal(editor.querySelector('img').src, 'https://market.cloud.tencent.com/uploaded.png')
  assert.equal(window.document.querySelector('#product-name').value, '保留商品名称')
  assert.equal(clicks, 0)
})

test('腾讯云市场只在最近字段边界内关联商品详情标签', async () => {
  const page = dom(`
    <div class="next-form">
      <div class="next-form-item target-detail">
        <div class="next-form-item-label"><label>商品详情</label></div>
        <div class="next-form-item-control"><div class="editor-shell">
          <div class="w-e-text" contenteditable="true"></div>
        </div></div>
      </div>
      <div class="next-form-item other-detail">
        <div class="next-form-item-label"><label>客户案例</label></div>
        <div class="next-form-item-control"><div class="editor-shell">
          <div class="w-e-text" contenteditable="true"></div>
        </div></div>
      </div>
    </div>
  `, 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET')
  const [target, other] = page.window.document.querySelectorAll('.w-e-text')
  const detailLabel = page.window.document.querySelector('.target-detail label')
  detailLabel.getBoundingClientRect = () => ({
    left: 726, right: 783, top: 388, bottom: 406, width: 57, height: 18,
  })
  target.getBoundingClientRect = () => ({
    left: 827, right: 1994, top: 422, bottom: 720, width: 1167, height: 298,
  })
  other.getBoundingClientRect = () => ({
    left: 827, right: 1994, top: 1231, bottom: 1529, width: 1167, height: 298,
  })
  attachWangEditor(target)

  const result = await injectPlatformArticle(page.window.document, {
    ...article,
    html: '<p>附件对应的商品详情</p>',
    portableMarkdown: '附件对应的商品详情',
  })

  assert.equal(result.platformId, 'tencent-market')
  assert.equal(target.textContent, '附件对应的商品详情')
  assert.equal(other.innerHTML, '')
})

test('腾讯云市场接受与唯一编辑器分层的全局商品详情标签', async () => {
  const page = dom(`
    <div class="market-label"><span>商品详情</span></div>
    <div class="nested"><div><div><div><div><div><div>
      <div class="w-e-text" contenteditable="true"></div>
    </div></div></div></div></div></div></div>
  `, 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET')
  const label = page.window.document.querySelector('.market-label span')
  const editor = page.window.document.querySelector('.w-e-text')
  label.getBoundingClientRect = () => ({
    left: 20, right: 100, top: 100, bottom: 130, width: 80, height: 30,
  })
  editor.getBoundingClientRect = () => ({
    left: 120, right: 620, top: 90, bottom: 390, width: 500, height: 300,
  })
  attachWangEditor(editor)

  const result = await injectPlatformArticle(page.window.document, {
    ...article,
    html: '<p>只写商品详情</p>',
    portableMarkdown: '只写商品详情',
  })

  assert.equal(result.platformId, 'tencent-market')
  assert.equal(editor.textContent, '只写商品详情')
})

test('腾讯云市场可在开放 ShadowRoot 中定位唯一商品详情编辑器', async () => {
  const page = dom('<div id="market-root"></div>', 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET')
  const root = page.window.document.querySelector('#market-root').attachShadow({ mode: 'open' })
  root.innerHTML = '<section><span>商品详情 *</span><div class="w-e-text" contenteditable="true"></div></section>'
  const editor = root.querySelector('.w-e-text')
  attachWangEditor(editor)

  const result = await injectPlatformArticle(page.window.document, {
    ...article,
    html: '<p>Shadow 商品详情</p>',
    portableMarkdown: 'Shadow 商品详情',
  })

  assert.equal(result.platformId, 'tencent-market')
  assert.equal(editor.textContent, 'Shadow 商品详情')
})

test('腾讯云市场可在同源 iframe 中定位唯一商品详情编辑器', async () => {
  const page = dom('<iframe></iframe>', 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET')
  const frame = page.window.document.querySelector('iframe')
  frame.contentDocument.body.innerHTML = '<section><span>商品详情 *</span><div class="w-e-text" contenteditable="true"></div></section>'
  const editor = frame.contentDocument.querySelector('.w-e-text')
  attachWangEditor(editor)

  const result = await injectPlatformArticle(page.window.document, {
    ...article,
    html: '<p>iframe 商品详情</p>',
    portableMarkdown: 'iframe 商品详情',
  })

  assert.equal(result.platformId, 'tencent-market')
  assert.equal(editor.textContent, 'iframe 商品详情')
})

test('腾讯云市场拒绝与商品详情标签无结构或视觉关联的唯一编辑器', async () => {
  const page = dom(`
    <div><span>商品详情</span></div>
    <section><span>客户案例</span><div class="w-e-text" contenteditable="true"></div></section>
  `, 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET')

  await assert.rejects(
    injectPlatformArticle(page.window.document, {
      ...article,
      html: '<p>不得误写</p>',
      portableMarkdown: '不得误写',
    }),
    /未找到唯一且标注为“商品详情”的编辑器/,
  )
  assert.equal(page.window.document.querySelector('.w-e-text').innerHTML, '')
})

test('阿里云市场内嵌图片未上传时恢复原商品详情', async () => {
  const aliyun = dom(`
    <div class="acpn-form-item"><label>产品详情：</label>
      <div class="cke cke_editor_editor3"></div>
    </div>
  `, 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=68862')
  let aliyunHtml = '<p>原阿里云详情</p>'
  let aliyunUploadResponse
  let aliyunAborts = 0
  aliyun.window.confirm = () => true
  aliyun.window.CKEDITOR = { instances: { editor3: {
    getData: () => aliyunHtml,
    setData(html, options) { aliyunHtml = html; options?.callback?.() },
    on(_name, handler) { aliyunUploadResponse = handler },
    removeListener(_name, handler) {
      if (aliyunUploadResponse === handler) aliyunUploadResponse = null
    },
    fire(_name, data) {
      aliyunHtml = data.dataValue.replace(
        'data:image/png;base64,eA==',
        '<broken-image-without-url>',
      )
      aliyunUploadResponse({ data: { fileLoader: { xhr: { status: 200 } } } })
    },
    uploadRepository: { loaders: { first: { abort() { aliyunAborts += 1 } } } },
    focus() {},
  } } }

  await assert.rejects(
    injectPlatformArticle(aliyun.window.document, article, { imageUploadTimeoutMs: 20 }),
    /阿里云市场：内嵌图片没有完成平台上传/,
  )
  assert.equal(aliyunHtml, '<p>原阿里云详情</p>')
  assert.equal(aliyunAborts, 1)


})

test('阿里云市场原详情恢复失败时给出不可保存的明确错误', async () => {
  const page = dom(`
    <div class="acpn-form-item"><label>产品详情：</label>
      <div class="cke cke_editor_editor3"></div>
    </div>
  `, 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=68862')
  let currentHtml = '<p>原详情</p>'
  let uploadResponse
  page.window.confirm = () => true
  page.window.CKEDITOR = { instances: { editor3: {
    getData: () => currentHtml,
    setData(html, options) {
      if (html === '<p>原详情</p>' && currentHtml !== '<p>原详情</p>') {
        throw new Error('restore failed')
      }
      currentHtml = html
      options?.callback?.()
    },
    on(_name, handler) { uploadResponse = handler },
    removeListener() { uploadResponse = null },
    fire() {
      uploadResponse({ data: { fileLoader: { xhr: { status: 500 } } } })
    },
    focus() {},
  } } }

  await assert.rejects(
    injectPlatformArticle(page.window.document, article),
    /导入失败，且无法恢复原产品详情；请刷新页面且不要保存/,
  )
})

test('开源中国在已切换的空白 Markdown textarea 中填入', async () => {
  const page = dom(`
    <input placeholder="请输入标题">
    <textarea></textarea>
  `, 'https://my.oschina.net/u/1/blog/ai-write')

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'oschina')
  assert.equal(page.window.document.querySelector('input').value, article.title)
  assert.equal(page.window.document.querySelector('textarea').value, article.portableMarkdown)
})

test('开源中国未切换 Markdown 模式时明确失败且不改标题', async () => {
  const page = dom(`
    <input placeholder="请输入标题">
    <span class="editor-switch-text">切换到MD编辑器</span>
  `, 'https://my.oschina.net/u/1/blog/ai-write')

  await assert.rejects(
    injectPlatformArticle(page.window.document, article),
    /请先手动切换到 MD 编辑器/,
  )
  assert.equal(page.window.document.querySelector('input').value, '')
})

test('微信公众号只使用正文 ProseMirror 和编辑器 JSAPI', async () => {
  const page = dom(`
    <textarea id="title"></textarea>
    <div class="title-editor__input"><div class="ProseMirror"></div></div>
    <div id="body"><div class="ProseMirror"><p><br></p></div></div>
  `, 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2')
  const body = page.window.document.querySelector('#body .ProseMirror')
  page.window.__MP_Editor_JSAPI__ = {
    invoke({ apiName, apiParam, sucCb }) {
      assert.equal(apiName, 'mp_editor_set_content')
      body.innerHTML = apiParam.content
      sucCb()
    },
  }

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'wechat')
  assert.equal(page.window.document.querySelector('#title').value, article.title)
  assert.equal(body.querySelectorAll('img').length, 1)
  assert.equal(page.window.document.querySelector('.title-editor__input .ProseMirror').textContent, '')
})

test('微信公众号导入前清理有序列表中的空编号', async () => {
  const page = dom(`
    <textarea id="title"></textarea>
    <div id="body"><div class="ProseMirror"><p><br></p></div></div>
  `, 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2')
  let insertedHtml = ''
  page.window.__MP_Editor_JSAPI__ = {
    invoke({ apiParam, sucCb }) {
      insertedHtml = apiParam.content
      sucCb()
    },
  }
  const listArticle = {
    ...article,
    html: '<h2>对接说明</h2><ol>\n<li><br></li>\n<li>客户资料同步</li>\n<li><p><br></p></li>\n<li><img src="https://example.com/flow.png"></li>\n</ol>',
  }

  await injectPlatformArticle(page.window.document, listArticle)

  const inserted = new page.window.DOMParser().parseFromString(insertedHtml, 'text/html')
  const list = inserted.querySelector('ol')
  const items = [...list.querySelectorAll(':scope > li')]
  assert.equal(items.length, 2)
  assert.deepEqual([...list.childNodes].map((node) => node.nodeType), [1, 1])
  assert.equal(items[0].textContent, '客户资料同步')
  assert.equal(items[1].querySelector('img')?.src, 'https://example.com/flow.png')
})

test('微信公众号接受平台改写后的正文且不回滚', async () => {
  const page = dom(`
    <textarea id="title"></textarea>
    <div id="body"><div class="ProseMirror"><p><br></p></div></div>
  `, 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2')
  const body = page.window.document.querySelector('#body .ProseMirror')
  let calls = 0
  page.window.__MP_Editor_JSAPI__ = {
    invoke({ sucCb }) {
      calls += 1
      body.innerHTML = '<p>平台保留的正文</p>'
      sucCb()
    },
  }

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'wechat')
  assert.equal(body.innerHTML, '<p>平台保留的正文</p>')
  assert.equal(page.window.document.querySelector('#title').value, article.title)
  assert.equal(calls, 1)
})

test('百家号通过 UEditor 和 contenteditable 标题填入', async () => {
  const page = dom(`
    <div class="client_components_titleInput"><div contenteditable="true"></div></div>
    <iframe></iframe>
  `, 'https://baijiahao.baidu.com/builder/rc/edit?type=news')
  let currentHtml = '<p><br></p>'
  let contentChanges = 0
  page.window.UE_V2 = {
    instants: {
      ueditorInstant0: {
        getContent: () => currentHtml,
        setContent: (html) => { currentHtml = html },
        fireEvent: () => { contentChanges += 1 },
      },
    },
  }

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'baijiahao')
  assert.equal(currentHtml, article.html)
  assert.equal(page.window.document.querySelector('[contenteditable="true"]').textContent, article.title)
  assert.equal(contentChanges, 1)
})

test('开源中国接受平台改写后的内容且不回滚', async () => {
  const page = dom(
    '<input placeholder="标题"><textarea></textarea>',
    'https://my.oschina.net/u/1/blog/ai-write',
  )
  const body = page.window.document.querySelector('textarea')
  body.addEventListener('input', () => { body.value = '平台保留的 Markdown' })

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.bodyFilled, true)
  assert.equal(body.value, '平台保留的 Markdown')
  assert.equal(page.window.document.querySelector('input').value, article.title)
})

test('知乎先上传 data URL 图片，再用远程 URL 解析 Markdown', async () => {
  const uploadedUrl = 'https://pic4.zhimg.com/uploaded.png'
  let uploads = 0
  const { window, editor } = zhihuFixture(({ editor: body, dialog, parse }) => {
    assert.equal(
      body.textContent,
      article.portableMarkdown.replace('data:image/png;base64,eA==', uploadedUrl),
    )
    body.innerHTML = `<p>正文</p><img src="${uploadedUrl}">`
    parse.remove()
    const confirm = dialog.ownerDocument.createElement('button')
    confirm.textContent = '确认'
    dialog.append(confirm)
  })
  window.fetch = async (url, options) => {
    uploads += 1
    assert.equal(url, 'https://zhuanlan.zhihu.com/api/uploaded_images')
    assert.equal(options.method, 'POST')
    assert.equal(options.credentials, 'include')
    assert.equal(options.body.get('source'), 'article')
    assert.equal(options.body.get('picture').type, 'image/png')
    return { ok: true, json: async () => ({ src: uploadedUrl }) }
  }

  const result = await injectPlatformArticle(window.document, article)

  assert.equal(result.platformId, 'zhihu')
  assert.equal(uploads, 1)
  assert.equal(editor.textContent.includes('data:image'), false)
  assert.equal(editor.querySelector('img').src, uploadedUrl)
})

test('知乎图片上传失败时在粘贴前停止且不修改页面', async () => {
  let parseCalls = 0
  const { window, editor } = zhihuFixture(() => { parseCalls += 1 })
  window.fetch = async () => ({ ok: false, status: 403 })

  await assert.rejects(
    injectPlatformArticle(window.document, article),
    /知乎：图片上传失败（HTTP 403）/,
  )

  assert.equal(parseCalls, 0)
  assert.equal(editor.innerHTML, '')
  assert.equal(window.document.querySelector('textarea').value, '')
})

test('知乎通过 Markdown 粘贴与解析确认导入', async () => {
  const page = dom(`
    <textarea placeholder="请输入标题"></textarea>
    <div class="public-DraftEditor-content" contenteditable="true"></div>
    <button id="save">保存</button><button id="publish">发布</button><button id="other-confirm">确认</button>
  `, 'https://zhuanlan.zhihu.com/write')
  const { window } = page
  const editor = window.document.querySelector('[contenteditable="true"]')
  let saveClicks = 0
  window.document.querySelector('#save').onclick = () => { saveClicks += 1 }
  window.document.querySelector('#publish').onclick = () => { saveClicks += 1 }
  window.document.querySelector('#other-confirm').onclick = () => { saveClicks += 1 }

  class FakeDataTransfer {
    #data = new Map()
    setData(type, value) { this.#data.set(type, value) }
    getData(type) { return this.#data.get(type) ?? '' }
  }
  class FakeClipboardEvent extends window.Event {
    constructor(type, init) {
      super(type, init)
      this.clipboardData = init.clipboardData
    }
  }
  window.DataTransfer = FakeDataTransfer
  window.ClipboardEvent = FakeClipboardEvent
  editor.addEventListener('paste', (event) => {
    editor.textContent = event.clipboardData.getData('text/plain')
    const dialog = window.document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const parse = window.document.createElement('button')
    parse.textContent = '确认并解析'
    parse.onclick = () => {
      editor.innerHTML = zhihuArticle.html
      parse.remove()
      const confirm = window.document.createElement('button')
      confirm.textContent = '确认'
      dialog.append(confirm)
    }
    dialog.append(parse)
    window.document.body.append(dialog)
  })
  window.document.execCommand = (command) => {
    if (command === 'undo') editor.innerHTML = ''
    return true
  }

  const result = await injectPlatformArticle(window.document, zhihuArticle)

  assert.equal(result.platformId, 'zhihu')
  assert.equal(window.document.querySelector('textarea').value, zhihuArticle.title)
  assert.equal(editor.querySelectorAll('img').length, 1)
  assert.equal(saveClicks, 0)
})

test('知乎不会点击解析弹窗外新出现的无关确认按钮', async () => {
  let unrelatedClicks = 0
  const { window, editor } = zhihuFixture(({ window: pageWindow, editor: body, parse }) => {
    body.innerHTML = zhihuArticle.html
    parse.remove()
    const unrelated = pageWindow.document.createElement('button')
    unrelated.textContent = '确认'
    unrelated.onclick = () => { unrelatedClicks += 1 }
    pageWindow.document.body.append(unrelated)
  })

  await assert.rejects(
    injectPlatformArticle(window.document, zhihuArticle, { waitTimeoutMs: 20 }),
    /知乎：没有出现解析后的“确认”/,
  )
  assert.equal(unrelatedClicks, 0)
  assert.equal(editor.innerHTML, '')
  assert.equal(window.document.querySelector('textarea').value, '')
})

test('知乎接受解析器改写后的图片、表格与代码且不回滚', async () => {
  const richArticle = {
    title: '结构测试',
    html: '<img alt="图" src="https://example.com/image.png"><table><thead><tr><th>列</th></tr></thead></table><pre><code>line 1\n  line 2</code></pre>',
    portableMarkdown: '![图](https://example.com/image.png)\n\n| 列 |\n| --- |\n\n```text\nline 1\n  line 2\n```',
  }
  const { window, editor } = zhihuFixture(({ editor: body, dialog, parse }) => {
    body.innerHTML = '<p>平台保留的正文</p>'
    parse.remove()
    const confirm = dialog.ownerDocument.createElement('button')
    confirm.textContent = '确认'
    dialog.append(confirm)
  })

  const result = await injectPlatformArticle(window.document, richArticle, { waitTimeoutMs: 20 })

  assert.equal(result.platformId, 'zhihu')
  assert.equal(editor.innerHTML, '<p>平台保留的正文</p>')
  assert.equal(window.document.querySelector('textarea').value, richArticle.title)
})

test('今日头条通过 ProseMirror insertHTML 导入并保留结构', async () => {
  const page = dom(`
    <textarea placeholder="请输入标题"></textarea>
    <div class="ProseMirror" contenteditable="true"></div>
    <button id="save">保存</button><button id="publish">发布</button>
  `, 'https://mp.toutiao.com/profile_v4/graphic/publish')
  const { window } = page
  const editor = window.document.querySelector('.ProseMirror')
  let clicks = 0
  window.document.querySelector('#save').onclick = () => { clicks += 1 }
  window.document.querySelector('#publish').onclick = () => { clicks += 1 }
  window.document.execCommand = (command, _showUi, value) => {
    if (command === 'insertHTML') editor.innerHTML = value
    if (command === 'undo') editor.innerHTML = ''
    return true
  }

  const result = await injectPlatformArticle(window.document, article)

  assert.equal(result.platformId, 'toutiao')
  assert.equal(window.document.querySelector('textarea').value, article.title)
  assert.equal(editor.querySelectorAll('img').length, 1)
  assert.equal(clicks, 0)
})

test('今日头条为内嵌 PNG 标记粘贴上传，避免预览丢图', async () => {
  const page = dom(`
    <textarea placeholder="请输入标题"></textarea>
    <div class="ProseMirror" contenteditable="true"></div>
  `, 'https://mp.toutiao.com/profile_v4/graphic/publish')
  const { window } = page
  const editor = window.document.querySelector('.ProseMirror')
  window.document.execCommand = (command, _showUi, value) => {
    if (command === 'insertHTML') editor.innerHTML = value
    return true
  }

  await injectPlatformArticle(window.document, article)

  const image = editor.querySelector('img')
  assert.equal(image?.getAttribute('src'), 'data:image/png;base64,eA==')
  assert.equal(image?.getAttribute('needCheck'), 'true')
  assert.equal(image?.getAttribute('paste'), 'true')
})

test('百家号接受 UEditor 过滤后的正文且不回滚', async () => {
  const page = dom(`
    <div class="client_components_titleInput"><div contenteditable="true"></div></div>
  `, 'https://baijiahao.baidu.com/builder/rc/edit?type=news')
  let currentHtml = '<p><br></p>'
  let setCalls = 0
  page.window.UE_V2 = {
    instants: {
      ueditorInstant0: {
        getContent: () => currentHtml,
        setContent() {
          setCalls += 1
          currentHtml = '<p>平台保留的正文</p>'
        },
        fireEvent() {},
      },
    },
  }

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'baijiahao')
  assert.equal(currentHtml, '<p>平台保留的正文</p>')
  assert.equal(page.window.document.querySelector('[contenteditable="true"]').textContent, article.title)
  assert.equal(setCalls, 1)
})

test('知乎没有出现解析确认时执行 undo 并恢复标题', async () => {
  const page = dom(`
    <textarea placeholder="请输入标题"></textarea>
    <div class="public-DraftEditor-content" contenteditable="true"></div>
  `, 'https://zhuanlan.zhihu.com/write')
  const { window } = page
  const editor = window.document.querySelector('[contenteditable="true"]')
  class FakeDataTransfer {
    #data = new Map()
    setData(type, value) { this.#data.set(type, value) }
    getData(type) { return this.#data.get(type) ?? '' }
  }
  class FakeClipboardEvent extends window.Event {
    constructor(type, init) {
      super(type, init)
      this.clipboardData = init.clipboardData
    }
  }
  window.DataTransfer = FakeDataTransfer
  window.ClipboardEvent = FakeClipboardEvent
  editor.addEventListener('paste', (event) => {
    editor.textContent = event.clipboardData.getData('text/plain')
  })
  let undoCalls = 0
  window.document.execCommand = (command) => {
    if (command === 'undo') {
      undoCalls += 1
      editor.innerHTML = ''
    }
    return true
  }

  await assert.rejects(
    injectPlatformArticle(window.document, zhihuArticle, { waitTimeoutMs: 20 }),
    /知乎：没有出现“确认并解析”/,
  )
  assert.equal(editor.textContent, '')
  assert.equal(window.document.querySelector('textarea').value, '')
  assert.equal(undoCalls, 1)
})

test('今日头条接受 ProseMirror 改写后的正文且不回滚', async () => {
  const page = dom(`
    <textarea placeholder="请输入标题"></textarea>
    <div class="ProseMirror" contenteditable="true"></div>
  `, 'https://mp.toutiao.com/profile_v4/graphic/publish')
  const { window } = page
  const editor = window.document.querySelector('.ProseMirror')
  let undoCalls = 0
  window.document.execCommand = (command) => {
    if (command === 'insertHTML') editor.innerHTML = '<p>平台保留的正文</p>'
    if (command === 'undo') undoCalls += 1
    return true
  }

  const result = await injectPlatformArticle(window.document, article)

  assert.equal(result.platformId, 'toutiao')
  assert.equal(editor.innerHTML, '<p>平台保留的正文</p>')
  assert.equal(window.document.querySelector('textarea').value, article.title)
  assert.equal(undoCalls, 0)
})

test('已有 Markdown 文章确认后继续现有导入流程', async () => {
  const page = dom(`
    <input id="post-title" placeholder="标题" value="已有标题">
    <textarea id="md-editor">已有正文</textarea>
  `, 'https://my.oschina.net/u/1/blog/ai-write')
  let confirms = 0
  page.window.confirm = () => {
    confirms += 1
    return true
  }

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'oschina')
  assert.equal(confirms, 1)
  assert.equal(page.window.document.querySelector('#post-title').value, article.title)
  assert.equal(page.window.document.querySelector('#md-editor').value, article.portableMarkdown)
})

test('五个文章平台已有内容时取消确认不会修改页面', async () => {
  let baijiahaoSetCalls = 0
  const baijiahao = dom(`
    <div class="client_components_titleInput"><div contenteditable="true"></div></div>
  `, 'https://baijiahao.baidu.com/builder/rc/edit?type=news')
  baijiahao.window.UE_V2 = {
    instants: {
      ueditorInstant0: {
        getContent: () => '<p>已有正文</p>',
        setContent() { baijiahaoSetCalls += 1 },
      },
    },
  }
  const pages = [
    dom('<textarea placeholder="标题">已有标题</textarea><div class="public-DraftEditor-content" contenteditable="true"></div>', 'https://zhuanlan.zhihu.com/write'),
    dom('<textarea id="title">已有标题</textarea><div class="ProseMirror"><p><br></p></div>', 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2'),
    dom('<input placeholder="标题"><textarea>已有正文</textarea>', 'https://my.oschina.net/u/1/blog/ai-write'),
    baijiahao,
    dom('<textarea placeholder="标题"></textarea><div class="ProseMirror">已有正文</div>', 'https://mp.toutiao.com/profile_v4/graphic/publish'),
  ]

  for (const page of pages) {
    const before = page.window.document.documentElement.outerHTML
    let confirms = 0
    page.window.confirm = () => {
      confirms += 1
      return false
    }

    await assert.rejects(
      injectPlatformArticle(page.window.document, article),
      /已取消导入/,
    )

    assert.equal(confirms, 1)
    assert.equal(page.window.document.documentElement.outerHTML, before)
  }
  assert.equal(baijiahaoSetCalls, 0)
})

test('阿里云取消上传会停止加载器、移除监听并恢复原文后解锁', async () => {
  const page = dom('<div class="acpn-form-item"><label>产品详情：</label><div class="cke cke_editor_editor3"></div></div>', 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=68862')
  const { window } = page
  const element = window.document.querySelector('.cke')
  let html = '<p>原详情</p>'
  let listener
  let aborted = 0
  window.confirm = () => true
  window.CKEDITOR = { instances: { editor3: {
    container: { $: element },
    getData: () => html,
    setData(value, options) { html = value; options?.callback?.() },
    on(_name, callback) { listener = callback },
    removeListener(_name, callback) { if (listener === callback) listener = null },
    fire(_name, data) { html = data.dataValue },
    uploadRepository: { loaders: { image: { abort() { aborted++ } } } },
    focus() {},
  } } }
  const controller = new window.AbortController()
  const pending = injectPlatformArticle(window.document, article, { signal: controller.signal })
  await new Promise(resolve => window.setTimeout(resolve, 0))
  assert.equal(typeof listener, 'function')
  assert.equal(element.getAttribute('aria-busy'), 'true')
  controller.abort()
  await assert.rejects(pending, /已停止导入/)
  assert.equal(html, '<p>原详情</p>')
  assert.equal(aborted, 1)
  assert.equal(listener, null)
  assert.equal(element.hasAttribute('aria-busy'), false)
  window.close()
})

test('知乎暂停解析时撤销只作用于正文，并恢复用户正在操作的其他输入框', async () => {
  const { window, editor } = zhihuFixture(() => {})
  editor.tabIndex = 0
  const other = window.document.createElement('input')
  other.value = '保留其他字段'
  window.document.body.append(other)
  let undos = 0
  window.document.execCommand = command => {
    assert.equal(command, 'undo')
    assert.equal(window.document.activeElement, editor)
    undos++
    editor.textContent = ''
    return true
  }
  const controller = new window.AbortController()
  const pending = injectPlatformArticle(window.document, zhihuArticle, { signal: controller.signal })
  await new Promise(resolve => window.setTimeout(resolve, 0))
  other.focus()
  other.setSelectionRange(1, 3)
  controller.abort()
  await assert.rejects(pending, /已停止导入/)
  assert.equal(undos, 1)
  assert.equal(editor.textContent, '')
  assert.equal(window.document.activeElement, other)
  assert.deepEqual([other.selectionStart, other.selectionEnd], [1, 3])
  assert.equal(other.value, '保留其他字段')
  assert.equal(editor.hasAttribute('aria-busy'), false)
  window.close()
})
