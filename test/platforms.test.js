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

test('CSDN contenteditable 没有可验证状态 API 时明确待现场', async () => {
  const page = dom(`
    <div class="article-bar__title"><input placeholder="标题"></div>
    <pre class="editor__inner markdown-highlighting" contenteditable="true"></pre>
  `, 'https://editor.csdn.net/md/')

  await assert.rejects(
    injectPlatformArticle(page.window.document, article),
    /CSDN.*待真实页面/,
  )
  assert.equal(page.window.document.querySelector('input').value, '')
  assert.equal(page.window.document.querySelector('pre').textContent, '')
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

test('百家号标题没有可验证状态 API 时明确待现场', async () => {
  const page = dom(`
    <div class="client_components_titleInput"><div contenteditable="true"></div></div>
    <iframe></iframe>
  `, 'https://baijiahao.baidu.com/builder/rc/edit?type=news')
  let currentHtml = '<p><br></p>'
  page.window.UE_V2 = {
    instants: {
      ueditorInstant0: {
        getContent: () => currentHtml,
        setContent: (html) => { currentHtml = html },
        fireEvent() {},
      },
    },
  }

  await assert.rejects(
    injectPlatformArticle(page.window.document, article),
    /百家号.*待真实页面/,
  )
  assert.equal(currentHtml, '<p><br></p>')
  assert.equal(page.window.document.querySelector('[contenteditable="true"]').textContent, '')
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

test('知乎和头条在没有可回滚编辑器 API 时明确待现场，不改页面', async () => {
  const cases = [
    [
      'https://zhuanlan.zhihu.com/write',
      '<textarea placeholder="请输入标题"></textarea><div class="public-DraftEditor-content" contenteditable="true"></div>',
      '知乎',
    ],
    [
      'https://mp.toutiao.com/profile_v4/graphic/publish',
      '<textarea placeholder="请输入标题"></textarea><div class="ProseMirror"></div>',
      '今日头条',
    ],
  ]

  for (const [url, html, name] of cases) {
    const page = dom(html, url)
    await assert.rejects(
      injectPlatformArticle(page.window.document, article),
      new RegExp(`${name}.*待真实页面`),
    )
    assert.equal(page.window.document.querySelector('textarea').value, '')
    assert.equal(page.window.document.querySelector('[contenteditable="true"], .ProseMirror').textContent, '')
  }
})

test('任一已支持编辑器有标题或正文时都拒绝覆盖', async () => {
  const pages = [
    dom('<input id="post-title" value="已有标题"><textarea id="md-editor"></textarea>', 'https://i.cnblogs.com/posts/edit'),
    dom('<input placeholder="标题"><textarea>已有正文</textarea>', 'https://my.oschina.net/u/1/blog/ai-write'),
  ]

  for (const page of pages) {
    await assert.rejects(
      injectPlatformArticle(page.window.document, article),
      /已有内容/,
    )
  }
})
