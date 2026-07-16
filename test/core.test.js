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

function installFakeQuill(window, transform = (html) => html) {
  const editor = window.document.querySelector('.ql-editor')
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

test('找不到真实 Quill 实例时在改动前失败', async () => {
  const dom = createSohuDom()
  await assert.rejects(
    injectSohuArticle(dom.window.document, {
      title: '不应写入标题',
      html: '<p>不应写入正文</p>',
    }),
    /无法取得搜狐 Quill 编辑器实例/,
  )
  assert.equal(dom.window.document.querySelector('.ql-editor').innerHTML, '<p><br></p>')
  assert.equal(dom.window.document.querySelector('input').value, '')
})

test('搜狐只接受部分结构时拒绝误报成功并恢复 Quill Delta', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const fake = installFakeQuill(window, () => '<p>正文</p>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '不应写入标题',
      html: '<p>正文</p><table><tbody><tr><td>表格</td></tr></tbody></table><img alt="图" src="data:image/png;base64,eA==">',
    }),
    /搜狐编辑器改变了文章结构/,
  )
  assert.equal(editor.innerHTML, '<p><br></p>')
  assert.equal(fake.getRestoreCalls(), 1)
  assert.deepEqual(fake.getRestoreSources(), ['user'])
  assert.deepEqual(fake.quill.getContents(), { ops: [{ insert: '\n' }] })
  assert.equal(window.document.querySelector('input').value, '')
})

test('结构数量和全文相同但节点语义改变时仍拒绝', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window, () => '<h2>AB</h2><p></p>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '',
      html: '<h2>A</h2><p>B</p>',
    }),
    /搜狐编辑器改变了文章结构/,
  )
})

test('表头被改成普通表格正文时拒绝', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window, () => '<table><tbody><tr><th>标题</th></tr></tbody></table>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '',
      html: '<table><thead><tr><th>标题</th></tr></thead></table>',
    }),
    /搜狐编辑器改变了文章结构/,
  )
})

test('代码块缩进或换行被改变时拒绝', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window, () => '<pre><code>if (ok) { return 1 }</code></pre>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '',
      html: '<pre><code>if (ok) {\n  return 1\n}</code></pre>',
    }),
    /搜狐编辑器改变了文章结构/,
  )
})

test('富文本样式被剥离时拒绝误报成功', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window, () => '<h2>标题</h2><p>正文</p>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '',
      html: '<h2 style="font-size:22px">标题</h2><p style="line-height:1.75">正文</p>',
    }),
    /搜狐编辑器改变了文章结构/,
  )
})

test('等价但声明顺序不同的样式仍可通过', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window, () => '<p style="font-size:16px;color:red">正文</p>')

  await injectSohuArticle(window.document, {
    title: '',
    html: '<p style="color:red;font-size:16px">正文</p>',
  })
})

test('列表起始值或表格跨列被改变时拒绝', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window, () => '<ol><li>第三项</li></ol><table><tbody><tr><td>跨列</td></tr></tbody></table>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '',
      html: '<ol start="3"><li value="3">第三项</li></ol><table><tbody><tr><td colspan="2">跨列</td></tr></tbody></table>',
    }),
    /搜狐编辑器改变了文章结构/,
  )
})

test('行内节点两侧空格丢失时拒绝误报成功', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window, () => '<p>A<strong>B</strong>C</p>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '',
      html: '<p>A <strong>B</strong> C</p>',
    }),
    /搜狐编辑器改变了文章结构/,
  )
})

test('图片来源或替代文字被改写时拒绝误报成功', async () => {
  const dom = createSohuDom()
  const { window } = dom
  installFakeQuill(window, () => '<p><img alt="错误图片" src="data:image/png;base64,eQ=="></p>')

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '',
      html: '<p><img alt="正确图片" src="data:image/png;base64,eA=="></p>',
    }),
    /搜狐编辑器改变了文章结构/,
  )
})

test('标题事件改写标题或正文时回滚整个导入', async () => {
  const dom = createSohuDom()
  const { window } = dom
  const editor = window.document.querySelector('.ql-editor')
  const title = window.document.querySelector('input')
  const fake = installFakeQuill(window)
  let titleInputEvents = 0
  title.addEventListener('input', () => {
    titleInputEvents += 1
    if (titleInputEvents === 1) {
      title.value = '被搜狐改写'
      editor.innerHTML = '<p>被搜狐改写</p>'
    }
  })

  await assert.rejects(
    injectSohuArticle(window.document, {
      title: '预期标题',
      html: '<p>预期正文</p>',
    }),
    /搜狐在写入后改变了标题或正文/,
  )
  assert.equal(fake.getRestoreCalls(), 1)
  assert.deepEqual(fake.getRestoreSources(), ['user'])
  assert.deepEqual(fake.quill.getContents(), { ops: [{ insert: '\n' }] })
  assert.equal(title.value, '')
  assert.equal(titleInputEvents, 2)
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
