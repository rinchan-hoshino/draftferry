import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { buildDiagnostic, sanitizeUrl } from '../src/diagnostic.ts'

describe('diagnostic', () => {
  it('sanitizeUrl strips sensitive query parameters while keeping safe route parameters', () => {
    assert.equal(
      sanitizeUrl(
        'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&token=secret123&ticket=abc',
      ),
      'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media%2Fappmsg_edit_v2',
    )
    assert.equal(
      sanitizeUrl(
        'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET&session=xyz',
      ),
      'https://console.cloud.tencent.com/serviceprovider/products/createNew?productType=MARKET',
    )
  })

  it('buildDiagnostic outputs structured JSON with stage and sanitized URL', () => {
    const raw = buildDiagnostic({
      version: '2.0.0',
      pageUrl:
        'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=42&auth=leak',
      platformId: 'aliyun-market',
      editorFound: true,
      titleFound: false,
      stage: 'inject',
      error: new Error('upload failed'),
    })
    const parsed = JSON.parse(raw) as {
      scriptVersion: string
      pageUrl: string
      platformId: string
      editorFound: boolean
      titleFound: boolean
      stage: string
      error: { message: string }
    }
    assert.equal(parsed.scriptVersion, '2.0.0')
    assert.equal(
      parsed.pageUrl,
      'https://msp.aliyun.com/msp/commodity/list/~/publish/basic?commodityId=42',
    )
    assert.equal(parsed.platformId, 'aliyun-market')
    assert.equal(parsed.editorFound, true)
    assert.equal(parsed.titleFound, false)
    assert.equal(parsed.stage, 'inject')
    assert.equal(parsed.error.message, 'upload failed')
  })
})
