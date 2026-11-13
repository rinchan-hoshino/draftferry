import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { detectPlatform, PLATFORMS } from '../src/platforms/index.js'
import { prepareWechatHtml } from '../src/platforms/wechat.js'

const CASES = {
  zhihu: ['https://zhuanlan.zhihu.com/write', 'https://zhuanlan.zhihu.com/p/12345'],
  wechat: ['https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit', 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_list'],
  oschina: ['https://my.oschina.net/rin/blog/ai-write', 'https://my.oschina.net/rin/blog/123'],
  baijiahao: ['https://baijiahao.baidu.com/builder/rc/edit?type=news', 'https://baijiahao.baidu.com/builder/rc/home'],
  toutiao: ['https://mp.toutiao.com/profile_v4/graphic/publish', 'https://mp.toutiao.com/profile_v4/graphic/list'],
  sohu: ['https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle', 'https://mp.sohu.com/mpfe/v4/contentManagement/news/list'],
  'aliyun-market': ['https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=9', 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic'],
  'tencent-market': ['https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET', 'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=OTHER'],
}

test('every platform has a positive and a negative URL in its test case', () => {
  assert.deepEqual(PLATFORMS.map(p => p.id).sort(), Object.keys(CASES).sort())
})

for (const [id, [yes, no]] of Object.entries(CASES)) {
  test(`${id} matches its editor page and not other pages`, () => {
    const platform = PLATFORMS.find(p => p.id === id)
    assert.equal(platform.match(new URL(yes)), true, `should match ${yes}`)
    assert.equal(platform.match(new URL(no)), false, `should not match ${no}`)
    assert.equal(detectPlatform(yes)?.id, id)
    assert.equal(detectPlatform(no), null)
  })
}

test('wechat keeps trailing editable paragraph after a table', () => {
  const { window } = new JSDOM('')
  const out = prepareWechatHtml(window.document, '<h2>标题</h2><table><tr><td>a</td></tr></table>')
  assert.match(out, /border-left: 4px solid rgb\(216, 165, 34\)/)
  assert.match(out, /<\/table><p[^>]*><br><\/p>$/)
})
