import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import {
  calculatePngDimensions,
  createMermaidPngRenderer,
  svgToPngDataUrl,
} from '../src/mermaid-png.js'

test('Mermaid PNG 保留图表自然尺寸，不再为了清晰度放大版面', () => {
  assert.deepEqual(calculatePngDimensions(560, 100), {
    width: 560,
    height: 100,
  })
  assert.deepEqual(calculatePngDimensions(2000, 200), {
    width: 1000,
    height: 100,
  })
  assert.deepEqual(calculatePngDimensions(800, 4000), {
    width: 640,
    height: 3200,
  })
})

test('SVG 通过同源 data URL 转成白底 PNG，并使用受限画布尺寸', async () => {
  const dom = new JSDOM('')
  const calls = []
  let imageSource = ''
  const context = {
    fillStyle: '',
    fillRect(...args) { calls.push(['fillRect', ...args]) },
    drawImage(...args) { calls.push(['drawImage', ...args.slice(1)]) },
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => 'data:image/png;base64,dGVzdA==',
  }
  class FakeImage {
    set src(value) {
      imageSource = value
      queueMicrotask(() => this.onload())
    }
  }
  const windowObject = {
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Image: FakeImage,
    document: {
      createElement(name) {
        assert.equal(name, 'canvas')
        return canvas
      },
    },
  }

  const result = await svgToPngDataUrl(
    '<svg viewBox="0 0 2000 200"><rect width="2000" height="200"/></svg>',
    windowObject,
  )

  assert.equal(result, 'data:image/png;base64,dGVzdA==')
  assert.match(imageSource, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/)
  assert.equal(imageSource.startsWith('blob:'), false)
  assert.equal(canvas.width, 1000)
  assert.equal(canvas.height, 100)
  assert.equal(context.fillStyle, '#ffffff')
  assert.deepEqual(calls[0], ['fillRect', 0, 0, 1000, 100])
  assert.deepEqual(calls[1].slice(0, 1), ['drawImage'])
  assert.deepEqual(calls[1].slice(-4), [0, 0, 1000, 100])
  dom.window.close()
})

test('无效 SVG 在创建画布前明确失败', async () => {
  const dom = new JSDOM('')
  await assert.rejects(
    svgToPngDataUrl('<svg', {
      DOMParser: dom.window.DOMParser,
      XMLSerializer: dom.window.XMLSerializer,
      Image: class {},
      document: { createElement: () => assert.fail('不应创建画布') },
    }),
    /无效的 SVG/,
  )
  dom.window.close()
})

test('Mermaid 只在首次转图时加载，并缓存重复图表', async () => {
  let loadCalls = 0
  let initializeCalls = 0
  let renderCalls = 0
  let convertCalls = 0
  const mermaid = {
    initialize(options) {
      initializeCalls += 1
      assert.equal(options.startOnLoad, false)
      assert.equal(options.theme, 'default')
    },
    async render(_id, source) {
      renderCalls += 1
      return { svg: `<svg viewBox="0 0 560 100"><text>${source}</text></svg>` }
    },
  }
  const render = createMermaidPngRenderer({
    loadMermaid: async () => {
      loadCalls += 1
      return mermaid
    },
    convertSvg: async () => {
      convertCalls += 1
      return 'data:image/png;base64,dGVzdA=='
    },
  })

  const [first, concurrent] = await Promise.all([
    render('graph LR\nA-->B'),
    render('graph LR\nA-->B'),
  ])
  const repeated = await render('graph LR\nA-->B')

  assert.equal(first, 'data:image/png;base64,dGVzdA==')
  assert.equal(concurrent, first)
  assert.equal(repeated, first)
  assert.equal(loadCalls, 1)
  assert.equal(initializeCalls, 1)
  assert.equal(renderCalls, 1)
  assert.equal(convertCalls, 1)
})

test('Mermaid 瞬时加载失败后可以在下一次转换时重试', async () => {
  let loadCalls = 0
  const mermaid = {
    initialize() {},
    async render() {
      return { svg: '<svg viewBox="0 0 10 10"></svg>' }
    },
  }
  const render = createMermaidPngRenderer({
    loadMermaid: async () => {
      loadCalls += 1
      if (loadCalls === 1) throw new Error('temporary load failure')
      return mermaid
    },
    convertSvg: async () => 'data:image/png;base64,dGVzdA==',
  })

  await assert.rejects(render('graph TD\nA-->B'), /temporary load failure/)
  assert.equal(await render('graph TD\nA-->B'), 'data:image/png;base64,dGVzdA==')
  assert.equal(loadCalls, 2)
})

test('Mermaid 缓存最多保留 50 个最近图表', async () => {
  let renderCalls = 0
  const render = createMermaidPngRenderer({
    loadMermaid: async () => ({
      initialize() {},
      async render() {
        renderCalls += 1
        return { svg: '<svg viewBox="0 0 10 10"></svg>' }
      },
    }),
    convertSvg: async () => 'data:image/png;base64,dGVzdA==',
  })

  for (let index = 0; index < 51; index += 1) {
    await render(`graph TD\nA${index}-->B${index}`)
  }
  await render('graph TD\nA0-->B0')

  assert.equal(renderCalls, 52)
})
