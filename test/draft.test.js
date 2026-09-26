import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { Marked } from 'marked'
import { createDraft, renderDraft } from '../src/draft.js'

test('直接导出的 Markdown 保留任务列表、嵌套内容、HTML 行内边界和代码字面量', () => {
  const window = new JSDOM('').window
  const draft = createDraft('# Title\n\n- [x] checked\n\n  paragraph\n\n- [ ] open\n\nAn <em>inline **emphasis**</em> and <a href="https://example.com">link</a>.\n\n```html\n<script>literal</script>\n```', { windowObject: window })
  const first = renderDraft(draft)
  const second = renderDraft(draft)
  assert.deepEqual(first, second)
  const parsed = new JSDOM(new Marked().parse(first.portableMarkdown)).window.document
  assert.equal(parsed.querySelectorAll('input[type=checkbox]').length, 2)
  assert.equal(parsed.querySelectorAll('input[checked]').length, 1)
  assert.doesNotMatch(parsed.querySelector('ul').textContent, /\[[x ]\]/)
  assert.equal(parsed.querySelector('em strong').textContent, 'emphasis')
  assert.equal(parsed.querySelector('a').textContent, 'link')
  assert.equal(parsed.querySelector('a').getAttribute('href'), 'https://example.com')
  assert.equal(parsed.querySelector('pre').textContent.trim(), '<script>literal</script>')
  assert.doesNotMatch(first.html, /\sstyle=/)
  window.close()
})

test('导出的 Markdown 重新解析后也不恢复编码隐藏的脚本链接', () => {
  const window = new JSDOM('').window
  const draft = createDraft('[unsafe](javascript&#58;alert%281%29)\n\n[encoded](javascript&amp;#58;alert%281%29)\n\n[safe](https://example.com/?a=1&b=2)', { windowObject: window })
  const article = renderDraft(draft)
  const parsed = new JSDOM(new Marked().parse(article.portableMarkdown)).window.document
  assert.equal(parsed.querySelectorAll('a').length, 1)
  assert.equal(parsed.querySelector('a').href, 'https://example.com/?a=1&b=2')
  assert.doesNotMatch(article.html, /href="javascript/)
  window.close()
})

test('原始代码围栏不能变成可执行 HTML，紧凑嵌套列表不增加空段落', () => {
  const window = new JSDOM('').window
  const source = '~~~html `literal`\n<script>literal</script>\n~~~\n\n- outer\n  - inner\n- next'
  const article = renderDraft(createDraft(source, { windowObject: window }))
  const parsed = new JSDOM(new Marked().parse(article.portableMarkdown)).window.document
  assert.equal(parsed.querySelectorAll('script').length, 0)
  assert.equal(parsed.querySelector('pre').textContent.trim(), '<script>literal</script>')
  assert.equal(parsed.querySelectorAll('li').length, 3)
  assert.equal(parsed.querySelectorAll('li p').length, 0)
  window.close()
})

test('表格内转义分隔符、代码及链接标题在两种输出中保留', () => {
  const window = new JSDOM('').window
  const source = '| Key | Value |\n|:---|---:|\n| a\\|b | `c\\|d` |\n\n[链接](https://example.com "说明")\n\n![图](https://example.com/image.png "图注")'
  const article = renderDraft(createDraft(source, { windowObject: window }))
  for (const html of [article.html, new Marked().parse(article.portableMarkdown)]) {
    const parsed = new JSDOM(html).window.document
    assert.deepEqual([...parsed.querySelectorAll('td')].map(cell => cell.textContent), ['a|b', 'c|d'])
    assert.equal(parsed.querySelector('a').title, '说明')
    assert.equal(parsed.querySelector('img').title, '图注')
  }
  window.close()
})
