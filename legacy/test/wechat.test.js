import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { injectWechat } from '../src/adapters/wechat.js'

async function importHtml(html) {
  const page = new JSDOM('<textarea id="title"></textarea><div class="ProseMirror"><p><br></p></div>', {
    url: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2',
  })
  const { window } = page
  const body = window.document.querySelector('.ProseMirror')
  window.confirm = () => true
  let calls = 0
  window.__MP_Editor_JSAPI__ = { invoke({ apiParam, sucCb }) {
    calls++
    body.innerHTML = apiParam.content
    sucCb()
  } }
  const article = { title: '对接说明', html }
  await injectWechat(window.document, article)
  assert.equal(article.html, html, '不修改通用稿件')
  assert.equal(calls, 1, '仅通过原生内容接口写入一次')
  return { window, body }
}

// Removing the trailing text paragraph must fail these cases: the next input
// otherwise belongs to the final structural block or has no text position.
for (const [ending, html] of [
  ['表格', '<table><tbody><tr><td>客户资料</td></tr></tbody></table>'],
  ['图片', '<img src="https://example.com/image.png" alt="流程图">'],
  ['段落内图片', '<p><img src="https://example.com/image.png" alt="流程图"></p>'],
  ['列表', '<ul><li>客户资料</li></ul>'],
  ['引用', '<blockquote><p>客户资料</p></blockquote>'],
  ['代码', '<pre><code>客户资料</code></pre>'],
  ['分隔线', '<hr>'],
  ['文字', '<p>客户资料</p>'],
  ['标题', '<h2>客户资料</h2>'],
  ['仅标题稿件', ''],
  ['尾部文本', '<p><br></p>客户资料'],
  ['尾部注释与空白', '<table><tbody><tr><td>客户资料</td></tr></tbody></table>\n<!-- 尾部 -->\n'],
]) {
  test(`微信以${ending}结尾时保留正文之外的可输入段落`, async () => {
    const { window, body } = await importHtml(html)
    try {
      const paragraph = body.lastElementChild
      assert.equal(paragraph?.tagName, 'P')
      assert.equal(paragraph.textContent.trim(), '')
      assert.equal(paragraph.children.length, 1)
      assert.equal(paragraph.firstElementChild.tagName, 'BR')
      assert.equal(paragraph.style.fontSize, '16px')
      assert.equal(paragraph.style.lineHeight, '1.8')
      assert.equal(paragraph.style.color, 'rgb(43, 43, 43)')
      const initial = window.document.createElement('div')
      initial.innerHTML = html
      assert.equal(body.children.length, initial.children.length + 1)

      await injectWechat(window.document, { title: '对接说明', html: body.innerHTML })
      assert.equal(body.children.length, initial.children.length + 1, '再次准备不叠加空行')
    } finally { window.close() }
  })
}

for (const ending of ['<p><br></p>', '<p></p>', '<p>&nbsp;</p>', '<p><span><strong> </strong></span></p>']) {
  test(`微信复用已有末尾空段落 ${ending}`, async () => {
    const { window, body } = await importHtml(`<p>客户资料</p>${ending}\n<!-- 尾部 -->\n`)
    try {
      assert.equal(body.children.length, 2, '不增加额外空行')
      assert.equal(body.lastElementChild.tagName, 'P')
      assert.equal(body.lastElementChild.textContent.trim(), '')
      assert.ok(body.lastElementChild.querySelector('br'), '空段落有可点击行高')
      assert.equal(body.firstElementChild.textContent, '客户资料')
    } finally { window.close() }
  })
}
