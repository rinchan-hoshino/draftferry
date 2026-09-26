import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { ImportTask } from '../src/import-task.js'

const png = 'data:image/png;base64,eA=='
const markdownFile = text => ({ name: '稿件.md', type: 'text/markdown', text: async () => text })
const wait = () => new Promise(resolve => setTimeout(resolve, 0))
function fixture(options = {}) {
  const window = new JSDOM('', { url: 'https://editor.example.test/one' }).window
  const calls = []
  const target = { sameAs: other => other === target, commit: async (article, operation) => { calls.push({ article, operation }); return { bodyFilled: true } } }
  const task = new ImportTask({ windowObject: window, renderMermaid: async () => png, locateTarget: () => target, ...options })
  const context = () => ({ platformId: 'tencent-market', destination: '腾讯云市场 → 商品详情', field: '商品详情', url: window.location.href })
  return { window, task, target, calls, context }
}

test('补选缺失图片后沿用同一稿件，补齐才自动写入', async () => {
  const f = fixture()
  await f.task.start([markdownFile('# 稿件\n\n![一](one.png)\n\n![二](two.png)')], f.context())
  const draft = f.task.draft
  assert.equal(f.task.state.phase, 'missing')
  assert.equal(f.calls.length, 0)
  await f.task.resume(f.context(), [new f.window.File(['one'], 'one.png', { type: 'image/png' })])
  assert.equal(f.task.state.phase, 'missing')
  assert.deepEqual(f.task.state.assets.filter(asset => asset.status === 'missing').map(asset => asset.name), ['two.png'])
  assert.equal(f.calls.length, 0)
  await f.task.resume(f.context(), [new f.window.File(['two'], 'two.png', { type: 'image/png' })])
  assert.equal(f.task.state.phase, 'done')
  assert.equal(f.task.draft, draft)
  assert.equal(f.calls.length, 1)
  assert.match(f.calls[0].article.html, /alt="一"[\s\S]*alt="二"/)
  f.window.close()
})

test('同名但不同路径的图片不能悄悄复用同一个文件', async () => {
  const f = fixture()
  await f.task.start([
    markdownFile('![一](one/image.png)\n\n![二](two/image.png)'),
    new f.window.File(['one'], 'image.png', { type: 'image/png' }),
  ], f.context())
  assert.equal(f.task.state.phase, 'failed')
  assert.match(f.task.state.message, /同名图片/)
  assert.equal(f.calls.length, 0)
  f.window.close()
})

test('在文件读取时暂停，仍可直接继续，不必重新选稿件', async () => {
  let complete
  const f = fixture()
  let reads = 0
  const file = { name: '稿件.md', text: () => ++reads === 1 ? new Promise(resolve => { complete = resolve }) : Promise.resolve('正文') }
  const pending = f.task.start([file], f.context())
  f.task.pause()
  await pending
  assert.equal(f.task.state.canResume, true)
  await f.task.resume(f.context())
  complete('迟到的原读取')
  await wait()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].article.portableMarkdown, '正文')
  f.window.close()
})

test('图表失败后只重新转换失败项，保留已完成素材', async () => {
  const renders = []
  let failure = true
  const f = fixture({ renderMermaid: async (source, index) => {
    renders.push(index)
    if (index === 1 && failure) throw new Error('图表语法有误')
    return png
  } })
  await f.task.start([markdownFile('```mermaid\ngraph TD\n A --> B\n```\n\n```mermaid\ngraph TD\n C --> D\n```')], f.context())
  assert.equal(f.task.state.phase, 'failed')
  assert.equal(f.task.state.assets[0].status, 'ready')
  assert.equal(f.task.state.assets[1].status, 'failed')
  failure = false
  await f.task.resume(f.context())
  assert.deepEqual(renders, [0, 1, 1])
  assert.equal(f.task.state.phase, 'done')
  f.window.close()
})

test('暂停立即终止等待，迟到的图表结果不会写入或覆盖新稿件状态', async () => {
  let complete
  const f = fixture({ renderMermaid: () => new Promise(resolve => { complete = resolve }) })
  const first = f.task.start([markdownFile('```mermaid\ngraph TD\n A --> B\n```')], f.context())
  await wait()
  f.task.pause()
  await first
  assert.equal(f.task.state.phase, 'paused')
  assert.equal(f.calls.length, 0)
  await f.task.start([markdownFile('# 第二篇\n\n新的正文')], f.context())
  complete(png)
  await wait()
  assert.equal(f.calls.length, 1)
  assert.equal(f.task.state.title, '第二篇')
  assert.equal(f.task.state.phase, 'done')
  f.window.close()
})

test('读取期间切换页面会保留稿件并暂停，不会自动写到新页面', async () => {
  let complete
  const f = fixture()
  const started = f.task.start([{ name: '稿件.md', text: () => new Promise(resolve => { complete = resolve }) }], f.context())
  f.window.history.replaceState(null, '', '/two')
  complete('# 标题\n\n正文')
  await started
  assert.equal(f.task.state.phase, 'paused')
  assert.equal(f.calls.length, 0)
  assert.ok(f.task.draft)
  await f.task.resume({ ...f.context(), platformId: 'another' })
  assert.equal(f.calls.length, 0)
  await f.task.resume(f.context())
  assert.equal(f.calls.length, 1)
  f.window.close()
})

test('上传结果只对同一个目标编辑器复用，更换目标即清空', async () => {
  const f = fixture()
  let attempts = 0
  f.target.commit = async (_article, options) => {
    attempts++
    if (attempts === 1) { options.uploadCache.set('first-image', 'uploaded'); throw new Error('第二张失败') }
    assert.equal(options.uploadCache.get('first-image'), 'uploaded')
    throw new Error('暂未完成')
  }
  await f.task.start([markdownFile('正文')], f.context())
  await f.task.resume(f.context())
  const next = { sameAs: () => false, commit: async (_article, options) => {
    assert.equal(options.uploadCache.size, 0)
    return { bodyFilled: true }
  } }
  f.task.locateTarget = () => next
  await f.task.resume(f.context())
  assert.equal(f.task.state.phase, 'done')
  f.window.close()
})

test('暂停期间等待平台清理完成，不允许另一篇抢占仍在写入的编辑器', async () => {
  const f = fixture()
  let finish
  f.target.commit = () => new Promise((resolve, reject) => { finish = reject })
  const running = f.task.start([markdownFile('第一篇')], f.context())
  await wait()
  f.task.pause()
  assert.equal(f.task.state.phase, 'pausing')
  await f.task.start([markdownFile('第二篇')], f.context())
  assert.equal(f.task.draft.tokens[0].text, '第一篇')
  finish(new DOMException('已停止导入', 'AbortError'))
  await running
  assert.equal(f.task.state.phase, 'paused')
  f.window.close()
})

test('取消时恢复原文失败仍报告失败，不能被已暂停提示掩盖', async () => {
  const f = fixture()
  let finish
  f.target.commit = () => new Promise((resolve, reject) => { finish = reject })
  const running = f.task.start([markdownFile('正文')], f.context())
  await wait()
  f.task.pause()
  finish(new AggregateError([], '无法恢复原文，请刷新页面且不要保存'))
  await running
  assert.equal(f.task.state.phase, 'failed')
  assert.match(f.task.state.message, /不要保存/)
  f.window.close()
})
