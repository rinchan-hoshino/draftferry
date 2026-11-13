import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createArticleBuilder, splitTitle } from '../src/article.js'

const { window } = new JSDOM('')
const png = new window.File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' })
const noopMermaid = async () => { throw new Error('should not render') }

test('splitTitle takes the first level-one heading and removes only that line', () => {
  const md = '前言\n# 真标题\n正文\n# 第二个\n'
  const result = splitTitle(md, 'fallback')
  assert.equal(result.title, '真标题')
  assert.equal(result.markdown, '前言\n正文\n# 第二个\n')
})

test('splitTitle ignores hash lines inside fenced code', () => {
  const md = '```bash\n# 注释\n```\n# 标题\n'
  const result = splitTitle(md, 'fallback')
  assert.equal(result.title, '标题')
  assert.equal(result.markdown, '```bash\n# 注释\n```\n')
})

test('splitTitle falls back to the file name when no level-one heading exists', () => {
  const result = splitTitle('## 只有二级\n正文', '我的稿')
  assert.equal(result.title, '我的稿')
  assert.equal(result.markdown, '## 只有二级\n正文')
})

test('builder strips script tags and converts markdown', async () => {
  const build = createArticleBuilder({ window, renderMermaid: noopMermaid })
  const article = await build('# T\n\n**粗** <script>alert(1)</script>\n\n| a | b |\n| - | - |\n| 1 | 2 |', { fallbackTitle: 'x' })
  assert.equal(article.title, 'T')
  assert.match(article.html, /<strong>粗<\/strong>/)
  assert.match(article.html, /<table>/)
  assert.doesNotMatch(article.html, /<script/)
})

test('local images are matched by base name and inlined as data URLs', async () => {
  const build = createArticleBuilder({ window, renderMermaid: noopMermaid })
  const files = new Map([['a.png', png]])
  const article = await build('![x](images/a.png) ![y](https://example.com/b.png)', { files })
  assert.match(article.html, /src="data:image\/png;base64,/)
  assert.match(article.html, /src="https:\/\/example.com\/b.png"/)
  assert.deepEqual(article.missing, [])
  assert.equal(article.imageCount, 2)
})

test('missing images are listed and do not stop the import', async () => {
  const build = createArticleBuilder({ window, renderMermaid: noopMermaid })
  const article = await build('段落\n\n![缺](nowhere/gone.png)\n\n后文', { files: new Map() })
  assert.deepEqual(article.missing, ['nowhere/gone.png'])
  assert.match(article.html, /\[缺图：nowhere\/gone.png\]/)
  assert.match(article.html, /后文/)
})

test('mermaid blocks become images, and failures stay as code with an error message', async () => {
  const seen = []
  const renderMermaid = async (source) => {
    seen.push(source)
    if (source.includes('bad')) throw new Error('Mermaid 语法错误：bad')
    return 'data:image/png;base64,AAAA'
  }
  const build = createArticleBuilder({ window, renderMermaid })
  const article = await build('```mermaid\nflowchart LR\n  A-->B\n```\n\n```mermaid\nbad\n```')
  assert.deepEqual(seen, ['flowchart LR\n  A-->B', 'bad'])
  assert.match(article.html, /<img src="data:image\/png;base64,AAAA" alt="Mermaid 图">/)
  assert.match(article.markdown, /!\[Mermaid 图\]\(data:image\/png;base64,AAAA\)/)
  assert.match(article.html, /language-mermaid/)
  assert.deepEqual(article.mermaidErrors, ['Mermaid 语法错误：bad'])
})
