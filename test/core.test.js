import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { renderMarkdownArticle } from '../src/core.js'
import { hasMeaningfulEditorContent } from '../src/editor-content.js'
import { hasExistingSohuDraft, injectSohuArticle } from '../src/sohu.js'

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
  assert.match(article.html, /<table>/i)
  assert.match(article.html, /<pre data-rin-code-language="js">/i)
  assert.doesNotMatch(article.html, /\sstyle=/i)
  assert.match(article.html, /<img[^>]+data-rin-mermaid="true"/i)
  assert.match(article.html, /data:image\/png;base64,bWVybWFpZA==/)
  const renderedDocument = new JSDOM(article.html).window.document
  assert.equal(renderedDocument.querySelector('img[data-rin-mermaid]')?.parentElement?.tagName, 'P')
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
  { attachVueOwner = true, parentDepth = 1 } = {},
) {
  let contents = { ops: [{ insert: '\n' }] }
  let restoreCalls = 0
  let getterCalls = 0
  const restoreSources = []
  const container = editor.closest('.ql-container')
  const quill = {
    root: editor,
    container,
    clipboard: {
      dangerouslyPasteHTML(html) {
        editor.innerHTML = transform(html)
        contents = { ops: [{ insert: editor.textContent || '\n' }] }
      },
    },
    getContents() {
      return structuredClone(contents)
    },
    getLength() {
      return editor.textContent.length + 1
    },
    setContents(nextContents, source) {
      contents = structuredClone(nextContents)
      restoreCalls += 1
      restoreSources.push(source)
      editor.innerHTML = '<p><br></p>'
    },
  }
  if (attachVueOwner) {
    const data = {}
    Object.defineProperty(data, '__ob__', { value: {} })
    Object.defineProperty(data, 'quill', {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1
        return quill
      },
      set() {},
    })
    Object.defineProperty(data, 'editor', {
      configurable: true,
      get() { throw new Error('不得调用无关 Vue getter') },
    })
    let component = { _data: data }
    for (let depth = 0; depth < parentDepth; depth += 1) {
      component = { $parent: component }
    }
    Object.defineProperty(container, '__vue__', {
      configurable: true,
      value: component,
    })
  }
  return {
    quill,
    getGetterCalls: () => getterCalls,
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

test('搜狐导入时强制表格零间距并移除结构标签间的空白文本', async () => {
  const dom = createSohuDom()
  const { window } = dom
  let insertedHtml = ''
  installFakeQuill(window, (html) => {
    insertedHtml = html
    return html
  })

  await injectSohuArticle(window.document, {
    title: '连体表格',
    html: `<table style="width:100%">
      <thead>
        <tr><th>左</th><th>右</th></tr>
      </thead>
      <tbody>
        <tr><td style="border:1px solid #ccc">甲</td><td style="border:1px solid #ccc">乙</td></tr>
      </tbody>
    </table>`,
  })

  const inserted = new window.DOMParser().parseFromString(insertedHtml, 'text/html')
  const table = inserted.querySelector('table')
  assert.equal(table.getAttribute('cellspacing'), '0')
  assert.equal(table.style.getPropertyValue('border-collapse'), 'collapse')
  assert.equal(table.style.getPropertyPriority('border-collapse'), 'important')
  assert.equal(table.style.getPropertyValue('border-spacing'), '0px')
  assert.equal(
    [table, ...table.querySelectorAll('thead, tbody, tfoot, tr, colgroup')]
      .flatMap((element) => [...element.childNodes])
      .filter((node) => node.nodeType === window.Node.TEXT_NODE && node.nodeValue.trim() === '')
      .length,
    0,
  )
})

test('搜狐通过 Quill 保持完整正文、连续表格与 A-B-C 图片顺序', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window)

  await injectSohuArticle(window.document, {
    title: 'SOHU-0413',
    html: `
      <p>START</p>
      <table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody>
        <tr><td>A1</td><td>B1</td><td>C1</td></tr>
        <tr><td>A2</td><td>B2</td><td>C2</td></tr>
        <tr><td>A3</td><td>B3</td><td>C3</td></tr>
      </tbody></table>
      <img alt="A" src="https://example.invalid/a.png">
      <img alt="B" src="https://example.invalid/b.png">
      <img alt="C" src="https://example.invalid/c.png">
      <p>END</p>
    `,
  })

  const editor = window.document.querySelector('.ql-editor')
  assert.equal(editor.querySelectorAll('table').length, 1)
  assert.equal(editor.querySelectorAll('tbody tr').length, 3)
  assert.deepEqual(
    [...editor.querySelectorAll('img')].map((image) => image.alt),
    ['A', 'B', 'C'],
  )
  assert.equal(editor.textContent.includes('START'), true)
  assert.equal(editor.textContent.includes('END'), true)
})

test('搜狐忽略隐藏副本并沿可见编辑器的 Vue 父链取得 Quill', async () => {
  const dom = new JSDOM(`
    <input placeholder="请输入标题">
    <section hidden><div class="ql-container"><div class="ql-editor"><p><br></p></div></div></section>
    <section id="article-editor"><div class="ql-container"><div class="ql-editor" contenteditable="true"><p><br></p></div></div></section>
  `, { url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle' })
  const { window } = dom
  const editors = window.document.querySelectorAll('.ql-editor')
  const activeEditor = editors[1]
  const fake = installFakeQuill(window, (html) => html, activeEditor, { parentDepth: 8 })

  await injectSohuArticle(window.document, {
    title: '可见编辑器',
    html: '<p>只写真实正文</p>',
  })

  assert.equal(editors[0].textContent, '')
  assert.equal(activeEditor.textContent, '只写真实正文')
  assert.equal(fake.getGetterCalls(), 1)
})

test('搜狐只调用目标 Vue data 中固定 quill getter，不调用其他 getter', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const fake = installFakeQuill(window)

  await injectSohuArticle(window.document, {
    title: '响应式实例',
    html: '<p>正文</p><img alt="流程图" src="data:image/png;base64,eA==">',
  })

  assert.equal(fake.getGetterCalls(), 1)
  assert.equal(window.document.querySelector('input').value, '响应式实例')
  assert.equal(editor.querySelector('img')?.getAttribute('src'), 'data:image/png;base64,eA==')
})

test('搜狐不会调用缺少 Vue Observer 证据的同名 quill getter', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const container = editor.closest('.ql-container')
  let getterCalls = 0
  const data = {}
  Object.defineProperty(data, 'quill', {
    configurable: true,
    get() {
      getterCalls += 1
      throw new Error('不得调用未经 Vue Observer 验证的 getter')
    },
    set() {},
  })
  Object.defineProperty(container, '__vue__', {
    configurable: true,
    value: { _data: data },
  })

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '不应写入标题',
      html: '<p>不应写入正文</p>',
    }),
    /无法从目标搜狐 Vue 组件取得关联的 Quill 编辑器实例/,
  )

  assert.equal(getterCalls, 0)
})

test('搜狐 Vue 父链存在多个 quill 响应式槽时零 getter 调用并拒绝写入', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const container = editor.closest('.ql-container')
  const { quill } = installFakeQuill(window, undefined, editor, { attachVueOwner: false })
  let getterCalls = 0
  function observedData() {
    const data = {}
    Object.defineProperty(data, '__ob__', { value: {} })
    Object.defineProperty(data, 'quill', {
      configurable: true,
      get() {
        getterCalls += 1
        return quill
      },
      set() {},
    })
    return data
  }
  Object.defineProperty(container, '__vue__', {
    configurable: true,
    value: {
      _data: observedData(),
      $parent: { _data: observedData() },
    },
  })

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '不应写入标题',
      html: '<p>不应写入正文</p>',
    }),
    /无法从目标搜狐 Vue 组件取得关联的 Quill 编辑器实例/,
  )

  assert.equal(getterCalls, 0)
  assert.equal(editor.innerHTML, '<p><br></p>')
  assert.equal(window.document.querySelector('input').value, '')
})

test('搜狐拒绝 DOM expando、全局 Quill.find、paste 和 insertHTML fallback', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const container = editor.closest('.ql-container')
  const { quill } = installFakeQuill(window, undefined, editor, { attachVueOwner: false })
  let findCalls = 0
  let pasteCalls = 0
  let insertCalls = 0
  editor.__quill = quill
  container.__quill = quill
  window.Quill = {
    find() {
      findCalls += 1
      return quill
    },
  }
  editor.addEventListener('paste', () => { pasteCalls += 1 })
  window.document.execCommand = () => {
    insertCalls += 1
    return true
  }

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '不应写入标题',
      html: '<p>不应写入正文</p>',
    }),
    /无法从目标搜狐 Vue 组件取得关联的 Quill 编辑器实例/,
  )

  assert.equal(findCalls, 0)
  assert.equal(pasteCalls, 0)
  assert.equal(insertCalls, 0)
  assert.equal(editor.innerHTML, '<p><br></p>')
  assert.equal(window.document.querySelector('input').value, '')
})

test('搜狐拒绝 root 不属于当前正文的 Vue Quill 实例且不修改页面', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const unrelated = window.document.createElement('div')
  const { quill } = installFakeQuill(window)
  quill.root = unrelated
  quill.container = unrelated

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '不应写入标题',
      html: '<p>不应写入正文</p>',
    }),
    /无法从目标搜狐 Vue 组件取得关联的 Quill 编辑器实例/,
  )

  assert.equal(editor.innerHTML, '<p><br></p>')
  assert.equal(window.document.querySelector('input').value, '')
})

test('搜狐从唯一 Vue 槽取得跨上下文 Quill，即使反射看不到实例字段', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const container = editor.closest('.ql-container')
  const { quill: source } = installFakeQuill(window)
  const target = Object.create({
    getContents: source.getContents,
    getLength: source.getLength,
    setContents: source.setContents,
  })
  target.root = editor
  target.container = container
  target.clipboard = source.clipboard
  const directReads = []
  const quill = new Proxy(target, {
    getOwnPropertyDescriptor(object, name) {
      if (['root', 'container', 'clipboard'].includes(name)) return undefined
      return Reflect.getOwnPropertyDescriptor(object, name)
    },
    get(object, name, receiver) {
      if (['root', 'container', 'clipboard'].includes(name)) directReads.push(name)
      return Reflect.get(object, name, receiver)
    },
  })
  let getterCalls = 0
  const data = {}
  Object.defineProperty(data, '__ob__', { value: {} })
  Object.defineProperty(data, 'quill', {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1
      return quill
    },
    set() {},
  })
  Object.defineProperty(container, '__vue__', {
    configurable: true,
    value: { _data: data },
  })
  let pasteCalls = 0
  let insertCalls = 0
  editor.addEventListener('paste', () => { pasteCalls += 1 })
  window.document.execCommand = () => {
    insertCalls += 1
    return true
  }

  await injectSohuArticle(window.document, {
    title: '跨上下文实例',
    html: '<p>完整正文</p><img alt="A" src="https://example.invalid/a.png">',
  })

  assert.equal(getterCalls, 1)
  assert.deepEqual(directReads, ['root', 'clipboard'])
  assert.equal(window.document.querySelector('input').value, '跨上下文实例')
  assert.equal(editor.textContent, '完整正文')
  assert.deepEqual([...editor.querySelectorAll('img')].map((image) => image.alt), ['A'])
  assert.equal(pasteCalls, 0)
  assert.equal(insertCalls, 0)
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

test('原标题恢复失败时仍独立恢复 Quill Delta', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const title = window.document.querySelector('input')
  const editor = window.document.querySelector('.ql-editor')
  const fake = installFakeQuill(window)
  const nativeDescriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  let setterCalls = 0
  Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
    configurable: true,
    get: nativeDescriptor.get,
    set(value) {
      setterCalls += 1
      if (setterCalls === 1) {
        nativeDescriptor.set.call(this, value)
        throw new Error('partial title write')
      }
      throw new Error('title rollback failed')
    },
  })

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '部分写入标题',
      html: '<p>必须回滚的正文</p>',
    }),
    /搜狐：写入失败且无法恢复原内容；请刷新页面且不要保存/,
  )

  assert.equal(title.value, '部分写入标题')
  assert.equal(editor.innerHTML, '<p><br></p>')
  assert.equal(fake.getRestoreCalls(), 1)
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
