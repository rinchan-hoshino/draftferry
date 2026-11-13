import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDiagnostic } from '../src/diagnostic.js'

test('diagnostic JSON carries version, page, finds and the error stack', () => {
  const error = new Error('标题没有填进标题框')
  const parsed = JSON.parse(buildDiagnostic({
    version: '1.0.0',
    pageUrl: 'https://baijiahao.baidu.com/builder/rc/edit?type=news',
    platformId: 'baijiahao',
    editorFound: true,
    titleFound: false,
    error,
  }))
  assert.deepEqual(Object.keys(parsed).sort(), ['editorFound', 'error', 'pageUrl', 'platformId', 'scriptVersion', 'titleFound'])
  assert.equal(parsed.scriptVersion, '1.0.0')
  assert.equal(parsed.platformId, 'baijiahao')
  assert.equal(parsed.editorFound, true)
  assert.equal(parsed.titleFound, false)
  assert.equal(parsed.error.message, '标题没有填进标题框')
  assert.match(parsed.error.stack, /Error/)
})

test('diagnostic with no error has a null error field', () => {
  const parsed = JSON.parse(buildDiagnostic({ version: '1.0.0', pageUrl: 'x', editorFound: false, titleFound: false }))
  assert.equal(parsed.error, null)
})
