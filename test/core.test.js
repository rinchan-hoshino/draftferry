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

test('搜狐导入时强制表格零间距并折叠相邻边框', async () => {
  const dom = createSohuDom()
  const { window } = dom
  let insertedHtml = ''
  installFakeQuill(window, (html) => {
    insertedHtml = html
    return html
  })

  await injectSohuArticle(window.document, {
    title: '连体表格',
    html: '<table style="width:100%"><tbody><tr><td style="border:1px solid #ccc">左</td><td style="border:1px solid #ccc">右</td></tr></tbody></table>',
  })

  const inserted = new window.DOMParser().parseFromString(insertedHtml, 'text/html')
  const table = inserted.querySelector('table')
  assert.equal(table.getAttribute('cellspacing'), '0')
  assert.equal(table.style.getPropertyValue('border-collapse'), 'collapse')
  assert.equal(table.style.getPropertyPriority('border-collapse'), 'important')
  assert.equal(table.style.getPropertyValue('border-spacing'), '0px')
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

test('搜狐无 Quill 时绕过会拆表复制图片的原生粘贴处理器', async () => {
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
  let pasteEvents = 0
  editor.addEventListener('paste', (event) => {
    pasteEvents += 1
    event.preventDefault()
    const parsed = new window.DOMParser().parseFromString(
      event.clipboardData.getData('text/html'),
      'text/html',
    )
    const rows = [...parsed.querySelectorAll('tr')]
    const image = parsed.querySelector('img')
    editor.innerHTML = `<table><tbody>${rows[0].outerHTML}</tbody></table>`
      + `<p><br></p><table><tbody>${rows[1].outerHTML}</tbody></table>`
      + image.outerHTML + image.outerHTML
  })
  window.document.execCommand = (command, _showUi, html) => {
    assert.equal(command, 'insertHTML')
    editor.innerHTML = html
    return true
  }

  const result = await injectSohuArticle(window.document, {
    title: '结构不乱',
    html: '<table><tbody><tr><th>源系统</th></tr><tr><td>小米商城</td></tr></tbody></table><h2>流程</h2><img src="https://img.example/flow.png">',
  })

  assert.equal(result.bodyFilled, true)
  assert.equal(pasteEvents, 0)
  assert.equal(editor.querySelectorAll('table').length, 1)
  assert.equal(editor.querySelectorAll('tr').length, 2)
  assert.equal(editor.querySelectorAll('img').length, 1)
  assert.equal(window.document.querySelector('input').value, '结构不乱')
})

test('搜狐没有可见 Quill 实例时直接使用浏览器 insertHTML', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
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

test('搜狐 insertHTML 重排图片时拒绝成功并恢复原正文', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const previousHtml = editor.innerHTML
  window.document.execCommand = (command) => {
    if (command === 'insertHTML') {
      editor.innerHTML = '<img src="https://img.example/flow.png"><h2>流程标题</h2>'
        + '<table><tbody><tr><th>表头</th></tr><tr><td>内容</td></tr></tbody></table>'
      return true
    }
    assert.equal(command, 'undo')
    editor.innerHTML = previousHtml
    return true
  }

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '不得错位',
      html: '<h2>流程标题</h2><table><tbody><tr><th>表头</th></tr><tr><td>内容</td></tr></tbody></table><img src="https://img.example/flow.png">',
    }),
    /搜狐：浏览器插入后正文结构顺序不一致/,
  )

  assert.equal(editor.innerHTML, previousHtml)
  assert.equal(window.document.querySelector('input').value, '')
})

test('搜狐 insertHTML 交换同形表格行并跨普通段落移动图片时拒绝成功', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const previousHtml = editor.innerHTML
  window.document.execCommand = (command) => {
    if (command === 'insertHTML') {
      editor.innerHTML = '<img src="https://img.example/flow.png"><p>第一段</p><p>第二段</p>'
        + '<table><tbody><tr><td>第二行</td></tr><tr><td>第一行</td></tr></tbody></table>'
      return true
    }
    assert.equal(command, 'undo')
    editor.innerHTML = previousHtml
    return true
  }

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '完整顺序',
      html: '<p>第一段</p><img src="https://img.example/flow.png"><p>第二段</p>'
        + '<table><tbody><tr><td>第一行</td></tr><tr><td>第二行</td></tr></tbody></table>',
    }),
    /搜狐：浏览器插入后正文结构顺序不一致/,
  )

  assert.equal(editor.innerHTML, previousHtml)
  assert.equal(window.document.querySelector('input').value, '')
})

test('搜狐 insertHTML 丢失内联元素边界空格时拒绝成功', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const previousHtml = editor.innerHTML
  window.document.execCommand = (command) => {
    if (command === 'insertHTML') {
      editor.innerHTML = '<p>Hello<strong>world</strong></p>'
      return true
    }
    assert.equal(command, 'undo')
    editor.innerHTML = previousHtml
    return true
  }

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '空格语义',
      html: '<p>Hello <strong>world</strong></p>',
    }),
    /搜狐：浏览器插入后正文结构顺序不一致/,
  )

  assert.equal(editor.innerHTML, previousHtml)
  assert.equal(window.document.querySelector('input').value, '')
})

test('搜狐 insertHTML 将图片移过无文本语义分隔块时拒绝成功', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const previousHtml = editor.innerHTML
  window.document.execCommand = (command) => {
    if (command === 'insertHTML') {
      editor.innerHTML = '<img src="https://img.example/flow.png"><hr><p>后文</p>'
      return true
    }
    assert.equal(command, 'undo')
    editor.innerHTML = previousHtml
    return true
  }

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '语义块顺序',
      html: '<hr><img src="https://img.example/flow.png"><p>后文</p>',
    }),
    /搜狐：浏览器插入后正文结构顺序不一致/,
  )

  assert.equal(editor.innerHTML, previousHtml)
  assert.equal(window.document.querySelector('input').value, '')
})

test('搜狐浏览器插入后标题写入失败且无法 undo 时明确要求刷新且不要保存', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  window.document.execCommand = (command, _showUi, html) => {
    if (command === 'insertHTML') {
      editor.innerHTML = html
      return true
    }
    assert.equal(command, 'undo')
    return false
  }
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

test('找不到真实 Quill 实例且 insertHTML 未被接管时在改动前失败', async () => {
  const dom = createSohuDom()
  await assert.rejects(
    injectSohuArticle(dom.window.document, {
      title: '不应写入标题',
      html: '<p>不应写入正文</p>',
    }),
    /无法取得搜狐 Quill 编辑器实例.*浏览器 insertHTML 未被编辑器接管/,
  )
  assert.equal(dom.window.document.querySelector('.ql-editor').innerHTML, '<p><br></p>')
  assert.equal(dom.window.document.querySelector('input').value, '')
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
