import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createArticleBuilder, splitTitle } from '../src/markdown.js'

function makeEnv(renderMermaid = async () => 'data:image/png;base64,iVBORw0KGgo=') {
  const { window } = new JSDOM('')
  return {
    window,
    build: createArticleBuilder({ window, renderMermaid }),
  }
}

test('splitTitle extracts first top-level H1 and ignores H1 inside fenced code blocks', () => {
  const md = [
    '```markdown',
    '# Not A Title',
    '```',
    '',
    '# Real Title',
    '',
    'Body paragraph.',
  ].join('\n')
  const result = splitTitle(md, 'fallback')
  assert.equal(result.title, 'Real Title')
  assert.match(result.markdown, /# Not A Title/)
  assert.doesNotMatch(result.markdown, /^# Real Title/m)
})

test('splitTitle uses fallback when no top-level H1 exists', () => {
  const result = splitTitle('## Subtitle\n\nHello', 'my-draft')
  assert.equal(result.title, 'my-draft')
})

test('does not touch image syntax inside fenced code blocks or inline codespans', async () => {
  const { window, build } = makeEnv()
  const imgFile = new window.File(['pngbytes'], 'real.png', { type: 'image/png' })
  const md = [
    '# AST Test',
    '',
    'Inline code `![ignored](fake-inline.png)` and real ![ok](real.png).',
    '',
    '```md',
    '![also-ignored](fake-fenced.png)',
    '```',
    '',
    '~~~markdown',
    '![tilde-ignored](fake-tilde.png)',
    '~~~',
  ].join('\n')

  const article = await build(md, { files: new Map([['real.png', imgFile]]) })
  assert.equal(article.title, 'AST Test')
  assert.deepEqual(article.missing, [])
  assert.equal(article.imageCount, 1)
  assert.match(article.markdown, /`!\[ignored\]\(fake-inline\.png\)`/)
  assert.match(article.markdown, /!\[also-ignored\]\(fake-fenced\.png\)/)
  assert.match(article.markdown, /!\[tilde-ignored\]\(fake-tilde\.png\)/)
  assert.match(article.markdown, /!\[ok\]\(data:image\/png;base64,/)
  assert.doesNotMatch(article.html, /缺图/)
})

test('renders both backtick and tilde mermaid fences with progress and caches duplicates', async () => {
  const rendered = []
  const progress = []
  const { build } = makeEnv(async (code) => {
    rendered.push(code.trim())
    return 'data:image/png;base64,QUJD'
  })
  const md = [
    '# Diagrams',
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
    '',
    '~~~mermaid',
    'graph TD; A-->B;',
    '~~~',
  ].join('\n')

  const article = await build(md, { onProgress: msg => progress.push(msg) })
  assert.equal(rendered.length, 1, 'duplicate mermaid source should be cached')
  assert.equal(article.imageCount, 2)
  assert.deepEqual(article.mermaidErrors, [])
  assert.deepEqual(progress, ['渲染图表 1/2…', '渲染图表 2/2…'])
  assert.match(article.html, /<img[^>]+src="data:image\/png;base64,QUJD"/)
})

test('degrades gracefully when mermaid rendering throws', async () => {
  const { build } = makeEnv(async () => { throw new Error('syntax error') })
  const md = '# Fail\n\n~~~mermaid\nbad graph\n~~~\n'
  const article = await build(md)
  assert.equal(article.mermaidErrors.length, 1)
  assert.match(article.mermaidErrors[0], /syntax error/)
  assert.match(article.markdown, /~~~mermaid/)
  assert.match(article.html, /<pre><code/)
})

test('records missing local images as placeholders without breaking other images', async () => {
  const { build } = makeEnv()
  const md = '# Missing\n\n![one](missing.png)\n\n![remote](https://example.com/a.png)\n'
  const article = await build(md)
  assert.deepEqual(article.missing, ['missing.png'])
  assert.equal(article.imageCount, 1)
  assert.match(article.markdown, /\[缺图：missing\.png\]/)
  assert.match(article.html, /\[缺图：missing\.png\]/)
})
