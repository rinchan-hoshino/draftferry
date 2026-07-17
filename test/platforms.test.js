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

function dom(html, url) {
  return new JSDOM(html, { url })
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
    'cnblogs',
    'csdn',
    'zhihu',
    'wechat',
    'oschina',
    'baijiahao',
    'toutiao',
    'sohu',
  ])
})

test('按当前页面 hostname 识别八个平台', () => {
  const cases = [
    ['https://i.cnblogs.com/posts/edit', 'cnblogs'],
    ['https://editor.csdn.net/md/', 'csdn'],
    ['https://zhuanlan.zhihu.com/write', 'zhihu'],
    ['https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2', 'wechat'],
    ['https://my.oschina.net/u/1/blog/ai-write', 'oschina'],
    ['https://baijiahao.baidu.com/builder/rc/edit?type=news', 'baijiahao'],
    ['https://mp.toutiao.com/profile_v4/graphic/publish', 'toutiao'],
    ['https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle', 'sohu'],
  ]

  for (const [url, expected] of cases) {
    assert.equal(detectPlatform(new URL(url))?.id, expected, url)
  }
  assert.equal(detectPlatform(new URL('https://example.com/')), null)
})

test('博客园空白 Markdown 编辑器可填入且不点击保存发布', async () => {
  const page = dom(`
    <input id="post-title" placeholder="标题">
    <textarea id="md-editor"></textarea>
    <button id="save">保存</button><button id="publish">发布</button>
  `, 'https://i.cnblogs.com/posts/edit')
  let clicks = 0
  page.window.document.querySelector('#save').onclick = () => { clicks += 1 }
  page.window.document.querySelector('#publish').onclick = () => { clicks += 1 }

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'cnblogs')
  assert.equal(page.window.document.querySelector('#post-title').value, article.title)
  assert.equal(page.window.document.querySelector('#md-editor').value, article.portableMarkdown)
  assert.equal(clicks, 0)
})

test('CSDN 空白 Markdown contenteditable 可填入', async () => {
  const page = dom(`
    <div class="article-bar__title"><input placeholder="标题"></div>
    <pre class="editor__inner markdown-highlighting" contenteditable="true"></pre>
  `, 'https://editor.csdn.net/md/')

  const result = await injectPlatformArticle(page.window.document, article)

  assert.equal(result.platformId, 'csdn')
  assert.equal(page.window.document.querySelector('input').value, article.title)
  assert.equal(page.window.document.querySelector('pre').textContent, article.portableMarkdown)
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

test('微信公众号 JSAPI 改坏结构时回滚并保留空白标题', async () => {
  const page = dom(`
    <textarea id="title"></textarea>
    <div id="body"><div class="ProseMirror"><p><br></p></div></div>
  `, 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2')
  const body = page.window.document.querySelector('#body .ProseMirror')
  let calls = 0
  page.window.__MP_Editor_JSAPI__ = {
    invoke({ apiParam, sucCb }) {
      calls += 1
      body.innerHTML = calls === 1 ? '<p>只留下文字</p>' : apiParam.content
      sucCb()
    },
  }

  await assert.rejects(
    injectPlatformArticle(page.window.document, article),
    /微信公众号编辑器改变了文章结构/,
  )
  assert.equal(body.innerHTML, '<p><br></p>')
  assert.equal(page.window.document.querySelector('#title').value, '')
  assert.equal(calls, 2)
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

test('Markdown 编辑器写入后被改坏时验证回滚状态', async () => {
  const page = dom(`
    <input id="post-title" placeholder="标题">
    <textarea id="md-editor"></textarea>
  `, 'https://i.cnblogs.com/posts/edit')
  const textarea = page.window.document.querySelector('#md-editor')
  let inputEvents = 0
  textarea.addEventListener('input', () => {
    inputEvents += 1
    if (inputEvents === 1) textarea.value = '平台改坏的正文'
  })

  await assert.rejects(
    injectPlatformArticle(page.window.document, article),
    /博客园：编辑器在写入后改变了 Markdown/,
  )
  assert.equal(page.window.document.querySelector('#post-title').value, '')
  assert.equal(textarea.value, '')
  assert.equal(inputEvents, 2)
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
      editor.innerHTML = article.html
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

  const result = await injectPlatformArticle(window.document, article)

  assert.equal(result.platformId, 'zhihu')
  assert.equal(window.document.querySelector('textarea').value, article.title)
  assert.equal(editor.querySelectorAll('img').length, 1)
  assert.equal(saveClicks, 0)
})

test('知乎不会点击解析弹窗外新出现的无关确认按钮', async () => {
  let unrelatedClicks = 0
  const { window, editor } = zhihuFixture(({ window: pageWindow, editor: body, parse }) => {
    body.innerHTML = article.html
    parse.remove()
    const unrelated = pageWindow.document.createElement('button')
    unrelated.textContent = '确认'
    unrelated.onclick = () => { unrelatedClicks += 1 }
    pageWindow.document.body.append(unrelated)
  })

  await assert.rejects(
    injectPlatformArticle(window.document, article, { waitTimeoutMs: 20 }),
    /知乎：没有出现解析后的“确认”/,
  )
  assert.equal(unrelatedClicks, 0)
  assert.equal(editor.innerHTML, '')
  assert.equal(window.document.querySelector('textarea').value, '')
})

test('知乎解析后丢失 Mermaid 图片来源时回滚', async () => {
  const { window, editor } = zhihuFixture(({ editor: body, dialog, parse }) => {
    body.innerHTML = article.html
    body.querySelector('img').removeAttribute('src')
    parse.remove()
    const confirm = dialog.ownerDocument.createElement('button')
    confirm.textContent = '确认'
    dialog.append(confirm)
  })

  await assert.rejects(
    injectPlatformArticle(window.document, article, { waitTimeoutMs: 20 }),
    /知乎编辑器改变了这些内容：图片/,
  )
  assert.equal(editor.innerHTML, '')
  assert.equal(window.document.querySelector('textarea').value, '')
})

test('知乎解析后把 Mermaid 图片替换成错误 data URL 或远程 URL 时回滚', async () => {
  for (const replacement of [
    'data:image/png;base64,eQ==',
    'https://wrong.example/mermaid.png',
  ]) {
    const { window, editor } = zhihuFixture(({ editor: body, dialog, parse }) => {
      body.innerHTML = article.html
      body.querySelector('img').setAttribute('src', replacement)
      parse.remove()
      const confirm = dialog.ownerDocument.createElement('button')
      confirm.textContent = '确认'
      dialog.append(confirm)
    })

    await assert.rejects(
      injectPlatformArticle(window.document, article, { waitTimeoutMs: 20 }),
      /知乎编辑器改变了这些内容：图片/,
    )
    assert.equal(editor.innerHTML, '')
  }
})

test('知乎解析后改变表格拓扑和代码内容时回滚', async () => {
  const richArticle = {
    title: '结构测试',
    html: '<table><thead><tr><th>列</th></tr></thead><tbody><tr><td>值</td></tr></tbody></table><pre><code>line 1\n  line 2</code></pre>',
    portableMarkdown: '| 列 |\n| --- |\n| 值 |\n\n```text\nline 1\n  line 2\n```',
  }
  const { window, editor } = zhihuFixture(({ editor: body, dialog, parse }) => {
    body.innerHTML = richArticle.html
    const heading = body.querySelector('th')
    const plainCell = heading.ownerDocument.createElement('td')
    plainCell.textContent = heading.textContent
    heading.replaceWith(plainCell)
    body.querySelector('code').textContent = 'line 1 line 2'
    parse.remove()
    const confirm = dialog.ownerDocument.createElement('button')
    confirm.textContent = '确认'
    dialog.append(confirm)
  })

  await assert.rejects(
    injectPlatformArticle(window.document, richArticle, { waitTimeoutMs: 20 }),
    /表格、代码块/,
  )
  assert.equal(editor.innerHTML, '')
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

test('CSDN 写入后被改坏时恢复空白编辑器', async () => {
  const page = dom(`
    <div class="article-bar__title"><input placeholder="标题"></div>
    <pre class="editor__inner markdown-highlighting" contenteditable="true"></pre>
  `, 'https://editor.csdn.net/md/')
  const editor = page.window.document.querySelector('pre')
  let events = 0
  editor.addEventListener('input', () => {
    events += 1
    if (events === 1) editor.textContent = '平台改坏的正文'
  })

  await assert.rejects(
    injectPlatformArticle(page.window.document, article),
    /CSDN：编辑器在写入后改变了 Markdown/,
  )
  assert.equal(editor.textContent, '')
  assert.equal(page.window.document.querySelector('input').value, '')
  assert.equal(events, 2)
})

test('百家号正文被过滤时回滚 UEditor 和标题', async () => {
  const page = dom(`
    <div class="client_components_titleInput"><div contenteditable="true"></div></div>
  `, 'https://baijiahao.baidu.com/builder/rc/edit?type=news')
  let currentHtml = '<p><br></p>'
  let setCalls = 0
  page.window.UE_V2 = {
    instants: {
      ueditorInstant0: {
        getContent: () => currentHtml,
        setContent(html) {
          setCalls += 1
          currentHtml = setCalls === 1 ? '<p>只留下文字</p>' : html
        },
        fireEvent() {},
      },
    },
  }

  await assert.rejects(
    injectPlatformArticle(page.window.document, article),
    /百家号编辑器改变了文章结构/,
  )
  assert.equal(currentHtml, '<p><br></p>')
  assert.equal(page.window.document.querySelector('[contenteditable="true"]').textContent, '')
  assert.equal(setCalls, 2)
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
    injectPlatformArticle(window.document, article, { waitTimeoutMs: 20 }),
    /知乎：没有出现“确认并解析”/,
  )
  assert.equal(editor.textContent, '')
  assert.equal(window.document.querySelector('textarea').value, '')
  assert.equal(undoCalls, 1)
})

test('今日头条结构被改变时 undo 回滚正文和标题', async () => {
  const page = dom(`
    <textarea placeholder="请输入标题"></textarea>
    <div class="ProseMirror" contenteditable="true"></div>
  `, 'https://mp.toutiao.com/profile_v4/graphic/publish')
  const { window } = page
  const editor = window.document.querySelector('.ProseMirror')
  let undoCalls = 0
  window.document.execCommand = (command) => {
    if (command === 'insertHTML') editor.innerHTML = '<p>只留下文字</p>'
    if (command === 'undo') {
      undoCalls += 1
      editor.innerHTML = ''
    }
    return true
  }

  await assert.rejects(
    injectPlatformArticle(window.document, article),
    /今日头条编辑器改变了文章结构/,
  )
  assert.equal(editor.innerHTML, '')
  assert.equal(window.document.querySelector('textarea').value, '')
  assert.equal(undoCalls, 1)
})

test('任一已支持编辑器有标题或正文时都拒绝覆盖', async () => {
  const baijiahao = dom(`
    <div class="client_components_titleInput"><div contenteditable="true"></div></div>
  `, 'https://baijiahao.baidu.com/builder/rc/edit?type=news')
  baijiahao.window.UE_V2 = {
    instants: {
      ueditorInstant0: {
        getContent: () => '<p>已有正文</p>',
        setContent() {},
      },
    },
  }
  const pages = [
    dom('<input id="post-title" value="已有标题"><textarea id="md-editor"></textarea>', 'https://i.cnblogs.com/posts/edit'),
    dom('<div class="article-bar__title"><input></div><pre class="editor__inner" contenteditable="true"><img src="existing.png"></pre>', 'https://editor.csdn.net/md/'),
    dom('<textarea placeholder="标题">已有标题</textarea><div class="public-DraftEditor-content" contenteditable="true"></div>', 'https://zhuanlan.zhihu.com/write'),
    dom('<textarea id="title">已有标题</textarea><div class="ProseMirror"><p><br></p></div>', 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2'),
    dom('<input placeholder="标题"><textarea>已有正文</textarea>', 'https://my.oschina.net/u/1/blog/ai-write'),
    baijiahao,
    dom('<textarea placeholder="标题"></textarea><div class="ProseMirror">已有正文</div>', 'https://mp.toutiao.com/profile_v4/graphic/publish'),
  ]

  for (const page of pages) {
    await assert.rejects(
      injectPlatformArticle(page.window.document, article),
      /已有内容/,
    )
  }
})
