import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import {
  hasExistingSohuDraft,
  hasMeaningfulEditorContent,
  injectSohuArticle,
  renderMarkdownArticle,
} from '../src/core.js'

const renderWindow = new JSDOM('').window

const representativeMarkdown = `# 测试文章

开头正文。

<img src="https://example.com/tracker.png" onerror="alert('xss')">
<script>window.stolen = true</script>

| 项目 | 结果 |
| --- | --- |
| 表格 | 正常 |

\`\`\`js
console.log('hello')
\`\`\`

\`\`\`mermaid
graph TD
  A[开始] --> B[结束]
\`\`\`
`

test('将代表性 Markdown 转成经过清理的富文本与可移植 Markdown', async () => {
  const renderedMermaid = []
  const article = await renderMarkdownArticle(representativeMarkdown, {
    windowObject: renderWindow,
    renderMermaid: async (source) => {
      renderedMermaid.push(source)
      return 'data:image/png;base64,bWVybWFpZA=='
    },
  })

  assert.equal(article.title, '测试文章')
  assert.equal(renderedMermaid.length, 1)
  assert.match(renderedMermaid[0], /A\[开始\] --> B\[结束\]/)
  assert.doesNotMatch(article.html, /<h1[ >]/i)
  assert.doesNotMatch(article.html, /<script/i)
  assert.doesNotMatch(article.html, /onerror/i)
  assert.match(article.html, /<table[^>]+style=/i)
  assert.match(article.html, /<pre[^>]+style=/i)
  assert.match(article.html, /<img[^>]+data-rin-mermaid="true"/i)
  assert.match(article.html, /data:image\/png;base64,bWVybWFpZA==/)
  assert.doesNotMatch(article.portableMarkdown, /^# 测试文章$/m)
  assert.doesNotMatch(article.portableMarkdown, /```mermaid/)
  assert.doesNotMatch(article.portableMarkdown, /<script|onerror/i)
  assert.match(article.portableMarkdown, /\| 项目 \| 结果 \|/)
  assert.match(article.portableMarkdown, /```js\nconsole\.log\('hello'\)\n```/)
  assert.match(
    article.portableMarkdown,
    /!\[Mermaid 流程图 1\]\(data:image\/png;base64,bWVybWFpZA==\)/,
  )
})

test('拒绝未提供的本地相对图片，避免静默生成破图', async () => {
  await assert.rejects(
    renderMarkdownArticle('# 标题\n\n![图](./images/a.png)', {
      windowObject: renderWindow,
      renderMermaid: async () => 'data:image/png;base64,eA==',
    }),
    /找不到本地图片.*images\/a\.png/,
  )
})

test('可以用所选本地图片替换 Markdown 相对路径', async () => {
  const article = await renderMarkdownArticle('# 标题\n\n![图](./images/a.png)', {
    windowObject: renderWindow,
    localImages: new Map([
      ['images/a.png', 'data:image/png;base64,aW1hZ2U='],
    ]),
    renderMermaid: async () => 'data:image/png;base64,eA==',
  })

  assert.match(article.html, /data:image\/png;base64,aW1hZ2U=/)
})

function installFakeQuill(
  window,
  transform = (html) => html,
  editor = window.document.querySelector('.ql-editor'),
) {
  let contents = { ops: [{ insert: '\n' }] }
  let restoreCalls = 0
  const restoreSources = []
  const quill = {
    clipboard: {
      dangerouslyPasteHTML(html) {
        editor.innerHTML = transform(html)
        contents = { ops: [{ insert: editor.textContent || '\n' }] }
      },
    },
    getContents() {
      return structuredClone(contents)
    },
    setContents(nextContents, source) {
      contents = structuredClone(nextContents)
      restoreCalls += 1
      restoreSources.push(source)
      editor.innerHTML = '<p><br></p>'
    },
  }
  window.Quill = {
    find(node) {
      return node.classList?.contains('ql-container') ? quill : null
    },
  }
  return {
    quill,
    getRestoreCalls: () => restoreCalls,
    getRestoreSources: () => restoreSources,
  }
}

function createSohuDom() {
  return new JSDOM(`
    <input placeholder="请输入标题">
    <div class="ql-container"><div class="ql-editor"><p><br></p></div></div>
    <button id="save">保存</button>
    <button id="publish">发布</button>
  `, { url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle' })
}

test('通过搜狐 Quill API 原子填入内容，但不触发保存或发布', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  let saves = 0
  let publishes = 0
  window.confirm = () => { throw new Error('空白文章不应弹出覆盖确认') }
  window.document.querySelector('#save').addEventListener('click', () => { saves += 1 })
  window.document.querySelector('#publish').addEventListener('click', () => { publishes += 1 })
  installFakeQuill(window)

  await injectSohuArticle(window.document, {
    title: '测试标题',
    html: '<h2>小标题</h2><p>已填入正文</p>',
  })

  assert.equal(window.document.querySelector('input').value, '测试标题')
  assert.equal(editor.textContent, '小标题已填入正文')
  assert.equal(saves, 0)
  assert.equal(publishes, 0)
})

test('搜狐忽略隐藏的 Quill 副本并选择可见正文编辑器', async () => {
  const dom = new JSDOM(`
    <input placeholder="请输入标题">
    <section hidden><div class="ql-container"><div class="ql-editor"><p><br></p></div></div></section>
    <section id="article-editor"><div class="ql-container"><div class="ql-editor" contenteditable="true"><p><br></p></div></div></section>
  `, { url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle' })
  const { window } = dom
  const editors = window.document.querySelectorAll('.ql-editor')
  const activeEditor = editors[1]
  const { quill } = installFakeQuill(window, (html) => html, activeEditor)
  delete window.Quill
  activeEditor.closest('.ql-container').__quill = quill

  await injectSohuArticle(window.document, {
    title: '可见编辑器',
    html: '<p>只写真实正文</p>',
  })

  assert.equal(editors[0].textContent, '')
  assert.equal(activeEditor.textContent, '只写真实正文')
})

test('搜狐新版微前端可从编辑器容器的 __quill 取得实例', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const container = editor.closest('.ql-container')
  const { quill } = installFakeQuill(window)
  delete window.Quill
  container.__quill = quill

  await injectSohuArticle(window.document, {
    title: '新版编辑器',
    html: '<p>正文</p><img alt="流程图" src="data:image/png;base64,eA==">',
  })

  assert.equal(window.document.querySelector('input').value, '新版编辑器')
  assert.equal(editor.querySelector('img')?.getAttribute('src'), 'data:image/png;base64,eA==')
  assert.equal(editor.textContent.includes('data:image'), false)
})

test('搜狐可从编辑根节点属性或 Quill.find 向上查找实例', async () => {
  const directDom = createSohuDom()
  const directEditor = directDom.window.document.querySelector('.ql-editor')
  const { quill: directQuill } = installFakeQuill(directDom.window)
  directDom.window.Quill.find = () => { throw new Error('platform find failed') }
  directEditor.__quill = directQuill

  await injectSohuArticle(directDom.window.document, {
    title: '根节点实例',
    html: '<p>直接属性正文</p>',
  })
  assert.equal(directEditor.textContent, '直接属性正文')

  const bubbleDom = createSohuDom()
  const bubbleEditor = bubbleDom.window.document.querySelector('.ql-editor')
  const { quill: bubbleQuill } = installFakeQuill(bubbleDom.window)
  bubbleDom.window.Quill.find = (node, bubble) => (
    node === bubbleEditor && bubble ? bubbleQuill : null
  )

  await injectSohuArticle(bubbleDom.window.document, {
    title: '向上查找实例',
    html: '<p>向上查找正文</p>',
  })
  assert.equal(bubbleEditor.textContent, '向上查找正文')
})

test('搜狐没有可见 Quill 实例时通过编辑器原生粘贴事件导入', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
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
    event.preventDefault()
    editor.innerHTML = event.clipboardData.getData('text/html')
  })

  const result = await injectSohuArticle(window.document, {
    title: '原生粘贴',
    html: '<p>搜狐原生粘贴正文</p>',
  })

  assert.equal(result.bodyFilled, true)
  assert.equal(window.document.querySelector('input').value, '原生粘贴')
  assert.equal(editor.textContent, '搜狐原生粘贴正文')
})

test('搜狐原生粘贴吞掉表格图片时撤销并改用保留图片的 insertHTML', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
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
    event.preventDefault()
    const pasted = window.document.createElement('div')
    pasted.innerHTML = event.clipboardData.getData('text/html')
    pasted.querySelectorAll('img').forEach((image) => image.remove())
    editor.innerHTML = pasted.innerHTML
  })
  const commands = []
  const previousHtml = editor.innerHTML
  window.document.execCommand = (command, _showUi, html) => {
    commands.push(command)
    if (command === 'undo') editor.innerHTML = previousHtml
    if (command === 'insertHTML') editor.innerHTML = html
    return true
  }

  await injectSohuArticle(window.document, {
    title: '表格图片',
    html: '<table><tbody><tr><td>左</td><td><img src="https://media.example/image.png"></td><td>右</td></tr></tbody></table>',
  })

  assert.deepEqual(commands, ['undo', 'insertHTML'])
  assert.equal(editor.querySelectorAll('img').length, 1)
  assert.equal(editor.querySelector('img').src, 'https://media.example/image.png')
})

test('搜狐不能用旧草稿图片冒充本次导入图片', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  editor.innerHTML = '<p>旧正文</p><img src="https://media.example/old.png">'
  window.confirm = () => true
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
    event.preventDefault()
    editor.innerHTML = '<p>新正文，但新图片被吞掉</p><img src="https://media.example/old.png">'
  })
  const commands = []
  const previousHtml = editor.innerHTML
  window.document.execCommand = (command, _showUi, html) => {
    commands.push(command)
    if (command === 'undo') editor.innerHTML = previousHtml
    if (command === 'insertHTML') editor.innerHTML = html
    return true
  }

  await injectSohuArticle(window.document, {
    title: '不能冒充',
    html: '<p>新正文</p><img src="https://media.example/new.png">',
  })

  assert.deepEqual(commands, ['undo', 'insertHTML'])
  assert.equal(editor.querySelectorAll('img').length, 1)
  assert.equal(editor.querySelector('img').src, 'https://media.example/new.png')
})

test('搜狐不能用未被替换的同来源旧图片冒充本次导入图片', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  editor.innerHTML = '<p>旧正文</p><img src="https://media.example/same.png">'
  window.confirm = () => true
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
  const oldImage = editor.querySelector('img')
  editor.addEventListener('paste', (event) => {
    event.preventDefault()
    editor.querySelector('p').textContent = '新正文，但同来源新图片被吞掉'
  })
  const commands = []
  const previousHtml = editor.innerHTML
  window.document.execCommand = (command, _showUi, html) => {
    commands.push(command)
    if (command === 'undo') editor.innerHTML = previousHtml
    if (command === 'insertHTML') editor.innerHTML = html
    return true
  }

  await injectSohuArticle(window.document, {
    title: '同来源也不能冒充',
    html: '<p>新正文</p><img src="https://media.example/same.png">',
  })

  assert.deepEqual(commands, ['undo', 'insertHTML'])
  assert.notEqual(editor.querySelector('img'), oldImage)
  assert.equal(editor.querySelector('img').src, 'https://media.example/same.png')
})

test('搜狐没有可见 Quill 实例且粘贴事件未写入时回退浏览器 insertHTML', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  class FakeDataTransfer {
    #data = new Map()
    setData(type, value) { this.#data.set(type, value) }
  }
  class FakeClipboardEvent extends window.Event {
    constructor(type, init) {
      super(type, init)
      this.clipboardData = init.clipboardData
    }
  }
  window.DataTransfer = FakeDataTransfer
  window.ClipboardEvent = FakeClipboardEvent
  window.document.execCommand = (command, _showUi, html) => {
    assert.equal(command, 'insertHTML')
    editor.innerHTML = html
    return true
  }

  await injectSohuArticle(window.document, {
    title: '浏览器插入',
    html: '<p>MutationObserver 可见正文</p>',
  })

  assert.equal(editor.textContent, 'MutationObserver 可见正文')
  assert.equal(window.document.querySelector('input').value, '浏览器插入')
})

test('搜狐原生粘贴后标题写入失败且无法 undo 时明确要求刷新且不要保存', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
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
    event.preventDefault()
    editor.innerHTML = event.clipboardData.getData('text/html')
  })
  window.document.execCommand = () => false
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
    configurable: true,
    get: descriptor.get,
    set() { throw new Error('title setter failed') },
  })

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '触发标题失败',
      html: '<p>已改正文</p>',
    }),
    /搜狐：写入失败且无法恢复原内容；请刷新页面且不要保存/,
  )
})

test('找不到真实 Quill 实例且原生粘贴未被接管时在改动前失败', async () => {
  const dom = createSohuDom()
  await assert.rejects(
    injectSohuArticle(dom.window.document, {
      title: '不应写入标题',
      html: '<p>不应写入正文</p>',
    }),
    /无法取得搜狐 Quill 编辑器实例.*原生粘贴或浏览器插入未被编辑器接管/,
  )
  assert.equal(dom.window.document.querySelector('.ql-editor').innerHTML, '<p><br></p>')
  assert.equal(dom.window.document.querySelector('input').value, '')
})

test('搜狐 Quill 吞掉图片时拒绝成功并恢复原内容', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const fake = installFakeQuill(window, () => '<p>平台只保留文字</p>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '不得静默成功',
      html: '<p>文字</p><img alt="图" src="https://media.example/image.png">',
    }),
    /搜狐：导入后图片数量不完整/,
  )

  assert.equal(window.document.querySelector('input').value, '')
  assert.equal(editor.innerHTML, '<p><br></p>')
  assert.equal(fake.getRestoreCalls(), 1)
})

test('搜狐接受平台对写入结果的改写且不回滚', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const title = window.document.querySelector('input')
  const fake = installFakeQuill(window, () => '<p>平台保留的正文</p>')
  title.addEventListener('input', () => {
    title.value = '平台保留的标题'
    editor.innerHTML = '<p>平台二次改写的正文</p>'
  })

  const result = await injectSohuArticle(window.document, {
    title: '原始标题',
    html: '<p>原始正文</p>',
  })

  assert.equal(result.titleFilled, true)
  assert.equal(title.value, '平台保留的标题')
  assert.equal(editor.innerHTML, '<p>平台二次改写的正文</p>')
  assert.equal(fake.getRestoreCalls(), 0)
})

test('搜狐已有内容时取消确认不会修改页面', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const title = window.document.querySelector('input')
  const editor = window.document.querySelector('.ql-editor')
  title.value = '已有标题'
  editor.innerHTML = '<p>已有正文</p>'
  let confirms = 0
  let confirmMessage = ''
  window.confirm = (message) => {
    confirms += 1
    confirmMessage = message
    return false
  }

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '新标题',
      html: '<p>新正文</p>',
    }),
    /已取消导入/,
  )

  assert.equal(confirms, 1)
  assert.equal(confirmMessage, '当前文章已有内容，继续导入可能覆盖或合并现有内容，是否继续？')
  assert.equal(title.value, '已有标题')
  assert.equal(editor.innerHTML, '<p>已有正文</p>')
})

test('搜狐已有内容时确认后继续现有导入流程', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const title = window.document.querySelector('input')
  const editor = window.document.querySelector('.ql-editor')
  title.value = '已有标题'
  editor.innerHTML = '<p>已有正文</p>'
  installFakeQuill(window)
  window.confirm = () => true

  await injectSohuArticle(window.document, {
    title: '新标题',
    html: '<p>新正文</p>',
  })

  assert.equal(title.value, '新标题')
  assert.equal(editor.innerHTML, '<p>新正文</p>')
})

test('标题写入异常时恢复 Quill Delta 和原标题', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const fake = installFakeQuill(window)

  const nativeDescriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
    configurable: true,
    get: nativeDescriptor.get,
    set() { throw new Error('setter failed') },
  })

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '写入失败',
      html: '<p>正文</p>',
    }),
    /setter failed/,
  )
  assert.equal(editor.innerHTML, '<p><br></p>')
  assert.equal(fake.getRestoreCalls(), 1)
  assert.deepEqual(fake.getRestoreSources(), ['user'])
  assert.deepEqual(fake.quill.getContents(), { ops: [{ insert: '\n' }] })
})

test('识别搜狐编辑器是否已有标题或正文', () => {
  const empty = new JSDOM('<input placeholder="请输入标题"><div class="ql-editor"><p><br></p></div>')
  const titled = new JSDOM('<input placeholder="请输入标题" value="已有标题"><div class="ql-editor"><p><br></p></div>')
  const filled = new JSDOM('<input placeholder="请输入标题"><div class="ql-editor"><p>已有内容</p></div>')
  const customBlot = new JSDOM('<input placeholder="请输入标题"><div class="ql-editor"><span class="ql-formula" data-value="x"></span></div>')

  assert.equal(hasMeaningfulEditorContent(empty.window.document.querySelector('.ql-editor')), false)
  assert.equal(hasMeaningfulEditorContent(filled.window.document.querySelector('.ql-editor')), true)
  assert.equal(hasExistingSohuDraft(empty.window.document), false)
  assert.equal(hasExistingSohuDraft(titled.window.document), true)
  assert.equal(hasExistingSohuDraft(filled.window.document), true)
  assert.equal(hasExistingSohuDraft(customBlot.window.document), true)
})
