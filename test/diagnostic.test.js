import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDiagnostic, sanitizeUrl } from '../src/diagnostic.js'

test('sanitizeUrl strips sensitive query parameters while keeping safe route parameters', () => {
  assert.equal(
    sanitizeUrl('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&token=secret123&ticket=abc'),
    'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media%2Fappmsg_edit_v2',
  )
  assert.equal(
    sanitizeUrl('https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET&session=xyz'),
    'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET',
  )
})

test('buildDiagnostic outputs structured JSON with stage and sanitized URL', () => {
  const raw = buildDiagnostic({
    version: '1.0.0',
    pageUrl: 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=42&auth=leak',
    platformId: 'aliyun-market',
    editorFound: true,
    titleFound: false,
    stage: 'inject',
    error: new Error('upload failed'),
  })
  const parsed = JSON.parse(raw)
  assert.equal(parsed.scriptVersion, '1.0.0')
  assert.equal(parsed.pageUrl, 'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=42')
  assert.equal(parsed.platformId, 'aliyun-market')
  assert.equal(parsed.editorFound, true)
  assert.equal(parsed.titleFound, false)
  assert.equal(parsed.stage, 'inject')
  assert.equal(parsed.error.message, 'upload failed')
})
