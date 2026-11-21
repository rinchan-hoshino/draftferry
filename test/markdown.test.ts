import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import type { Code, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { describe, it } from 'vitest'
import { createArticleBuilder, splitTitle } from '../src/markdown.ts'
import type { MermaidRenderer } from '../src/types.ts'

function makeEnv(
  renderMermaid: MermaidRenderer = async () => 'data:image/png;base64,iVBORw0KGgo=',
) {
  const { window } = new JSDOM('')
  return {
    window: window as unknown as Window,
    build: createArticleBuilder({ window: window as unknown as Window, renderMermaid }),
  }
}

function extractCodeBlocks(markdown: string): Array<{ lang: string | null; value: string }> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  const blocks: Array<{ lang: string | null; value: string }> = []
  visit(tree, 'code', (node: Code) => {
    blocks.push({ lang: node.lang ?? null, value: node.value })
  })
  return blocks
}

describe('markdown unified AST pipeline', () => {
  it('splitTitle extracts first top-level H1 and ignores H1 inside fenced code blocks', () => {
    const md = ['```markdown', '# Not A Title', '```', '', '# Real Title', '', 'Body paragraph.'].join(
      '\n',
    )
    const result = splitTitle(md, 'fallback')
    assert.equal(result.title, 'Real Title')
    assert.match(result.markdown, /# Not A Title/)
    assert.doesNotMatch(result.markdown, /^# Real Title/m)
  })

  it('splitTitle uses fallback when no top-level H1 exists', () => {
    const result = splitTitle('## Subtitle\n\nHello', 'my-draft')
    assert.equal(result.title, 'my-draft')
  })

  it('does not touch image syntax inside fenced code blocks, indented blocks, or inline codespans', async () => {
    const { window, build } = makeEnv()
    const FileCtor = (window as unknown as { File: typeof File }).File
    const imgFile = new FileCtor(['pngbytes'], 'real.png', { type: 'image/png' })
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
      '',
      '    ![indented-ignored](fake-indented.png)',
    ].join('\n')

    const article = await build(md, { files: new Map([['real.png', imgFile]]) })
    assert.equal(article.title, 'AST Test')
    assert.deepEqual(article.missing, [])
    assert.equal(article.imageCount, 1)
    assert.match(article.markdown, /`!\[ignored\]\(fake-inline\.png\)`/)
    assert.match(article.markdown, /!\[also-ignored\]\(fake-fenced\.png\)/)
    assert.match(article.markdown, /!\[tilde-ignored\]\(fake-tilde\.png\)/)
    assert.match(article.markdown, /!\[indented-ignored\]\(fake-indented\.png\)/)
    assert.match(article.markdown, /!\[ok\]\(data:image\/png;base64,/)
    assert.doesNotMatch(article.html, /缺图/)
  })

  it('renders both backtick and tilde mermaid fences with progress and caches duplicates', async () => {
    const rendered: string[] = []
    const progress: string[] = []
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

    const article = await build(md, { onProgress: (msg) => progress.push(msg) })
    assert.equal(rendered.length, 1, 'duplicate mermaid source should be cached')
    assert.equal(article.imageCount, 2)
    assert.deepEqual(article.mermaidErrors, [])
    assert.deepEqual(progress, ['渲染图表 1/2…', '渲染图表 2/2…'])
    assert.match(article.html, /<img[^>]+src="data:image\/png;base64,QUJD"/)
  })

  it('degrades gracefully when mermaid rendering throws', async () => {
    const { build } = makeEnv(async () => {
      throw new Error('syntax error')
    })
    const md = '# Fail\n\n~~~mermaid\nbad graph\n~~~\n'
    const article = await build(md)
    assert.equal(article.mermaidErrors.length, 1)
    assert.match(article.mermaidErrors[0], /syntax error/)
    assert.match(article.markdown, /(?:```|~~~)mermaid/)
    assert.match(article.html, /<pre><code/)
  })

  it('records missing local images as placeholders without breaking other images', async () => {
    const { build } = makeEnv()
    const md = '# Missing\n\n![one](missing.png)\n\n![remote](https://example.com/a.png)\n'
    const article = await build(md)
    assert.deepEqual(article.missing, ['missing.png'])
    assert.equal(article.imageCount, 1)
    assert.match(article.markdown, /缺图：missing\.png/)
    assert.match(article.html, /\[缺图：missing\.png\]/)
  })

  it('blocks XSS payloads (script tags, event handlers, javascript: URIs, data:text/html)', async () => {
    const { build } = makeEnv()
    const md = [
      '# XSS Test',
      '',
      '<script>alert("xss")</script>',
      '',
      '<img src="x" onerror="alert(1)">',
      '',
      '<svg onload="alert(2)"></svg>',
      '',
      '[evil link](javascript:alert(3))',
      '',
      '![bad data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    ].join('\n')

    const article = await build(md)
    assert.doesNotMatch(article.html, /<script/i)
    assert.doesNotMatch(article.html, /onerror=/i)
    assert.doesNotMatch(article.html, /onload=/i)
    assert.doesNotMatch(article.html, /javascript:/i)
    assert.doesNotMatch(article.html, /data:text\/html/i)
  })

  it('property fuzz: preserves code block literals 100% byte-for-byte across 100 randomized AST combinations', async () => {
    const { window, build } = makeEnv()
    const FileCtor = (window as unknown as { File: typeof File }).File
    const imgFile = new FileCtor(['pngbytes'], 'real.png', { type: 'image/png' })

    // Deterministic PRNG (Mulberry32) so failures are 100% reproducible
    let seed = 0x5f3759df
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]

    const payloads = [
      '![x](a.png)',
      '# Fake H1 Inside Code',
      '<script>alert(1)</script>',
      '| col1 | col2 |\n| --- | --- |\n| a | b |',
      '- nested\n  - item',
      'const fn = (a: string) => `${a}![y](b.png)`',
      '```\nnested backticks\n```',
    ]

    for (let iter = 0; iter < 100; iter += 1) {
      const blocks: string[] = ['# Fuzz Title', '']
      const expectedCodes: string[] = []

      const count = 2 + Math.floor(rand() * 4)
      for (let i = 0; i < count; i += 1) {
        const inner = `${pick(payloads)}\n${pick(payloads)}`
        const kind = pick(['backtick3', 'backtick4', 'tilde3', 'indent'] as const)
        if (kind === 'backtick3' && !inner.includes('```')) {
          const lang = pick(['ts', 'py', 'bash', ''])
          blocks.push(`\`\`\`${lang}\n${inner}\n\`\`\``)
          expectedCodes.push(inner)
        } else if (kind === 'backtick4') {
          const lang = pick(['md', 'ts', ''])
          blocks.push(`\`\`\`\`${lang}\n${inner}\n\`\`\`\``)
          expectedCodes.push(inner)
        } else if (kind === 'tilde3') {
          const lang = pick(['rust', 'go', ''])
          blocks.push(`~~~${lang}\n${inner}\n~~~`)
          expectedCodes.push(inner)
        } else {
          blocks.push('Paragraph before indented code.')
          blocks.push('')
          const indented = inner
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n')
          blocks.push(indented)
          expectedCodes.push(inner)
        }
        blocks.push('')
        if (rand() > 0.4) {
          blocks.push('| H1 | H2 |\n| --- | --- |\n| ![ok](real.png) | `![in](no.png)` |')
          blocks.push('')
        }
        if (rand() > 0.5) {
          blocks.push('- item 1\n  - nested 1.1\n    - deep 1.1.1')
          blocks.push('')
        }
      }

      const source = blocks.join('\n')
      const article = await build(source, { files: new Map([['real.png', imgFile]]) })
      const actualBlocks = extractCodeBlocks(article.markdown)
      assert.equal(
        actualBlocks.length,
        expectedCodes.length,
        `iter ${iter}: code block count mismatch`,
      )
      for (let i = 0; i < expectedCodes.length; i += 1) {
        assert.equal(
          actualBlocks[i].value,
          expectedCodes[i],
          `iter ${iter}, block ${i}: code literal mutated!`,
        )
      }
    }
  })
})
