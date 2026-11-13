import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { collectSohuEditorPreflight } from '../src/sohu-preflight.js'

function createPage() {
  return new JSDOM(`
    <div class="ql-container">
      <div class="ql-editor" contenteditable="true"><p><br></p></div>
    </div>
  `, { url: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle' })
}

function createCandidate(editor, overrides = {}) {
  let methodCalls = 0
  const candidate = {
    root: editor,
    container: editor.parentElement,
    clipboard: {
      dangerouslyPasteHTML() { methodCalls += 1 },
    },
    getContents() { methodCalls += 1 },
    getLength() { methodCalls += 1 },
    setContents() { methodCalls += 1 },
    PRIVATE_COMPONENT_VALUE: 'PRIVATE BODY',
    ...overrides,
  }
  return { candidate, getMethodCalls: () => methodCalls }
}

function createObservedData(candidate, getterCounter) {
  const data = {}
  Object.defineProperty(data, '__ob__', { value: {} })
  Object.defineProperty(data, 'quill', {
    configurable: true,
    enumerable: true,
    get() {
      getterCounter.calls += 1
      if (candidate instanceof Error) throw candidate
      return candidate
    },
    set() {},
  })
  Object.defineProperty(data, 'editor', {
    configurable: true,
    get() { throw new Error('must not invoke unrelated getter') },
  })
  return data
}

function attachOwner(element, dataChain) {
  let component = null
  for (const data of [...dataChain].reverse()) {
    component = { _data: data, $parent: component }
  }
  Object.defineProperty(element, '__vue__', {
    configurable: true,
    value: component,
  })
}

test('搜狐实例预检在唯一响应式槽返回目标 Quill 时只报告固定类别', () => {
  const dom = createPage()
  const editor = dom.window.document.querySelector('.ql-editor')
  const getterCounter = { calls: 0 }
  const { candidate, getMethodCalls } = createCandidate(editor)
  attachOwner(editor.parentElement, [createObservedData(candidate, getterCounter)])

  const result = collectSohuEditorPreflight({
    document: dom.window.document,
    version: 'test-version',
  })
  const text = JSON.stringify(result)

  assert.deepEqual(result, {
    schema: 1,
    draftferryVersion: 'test-version',
    operation: 'sohu-editor-preflight',
    editorCount: 1,
    ownerCount: 1,
    slotCount: 1,
    getterStatus: 'returned',
    apiShape: {
      stateSnapshot: true,
      lengthRead: true,
      stateRestore: true,
      htmlImport: true,
    },
    rootRelation: 'exact',
    result: 'validated',
    truncated: false,
  })
  assert.equal(getterCounter.calls, 1)
  assert.equal(getMethodCalls(), 0)
  assert.equal(text.includes('PRIVATE'), false)
  assert.equal(text.includes('__vue__'), false)
  assert.equal(text.includes('dangerouslyPasteHTML'), false)
})

test('搜狐实例预检覆盖较深 DOM 祖先上的目标 Vue owner', () => {
  const dom = createPage()
  const editor = dom.window.document.querySelector('.ql-editor')
  let outer = editor.parentElement
  for (let depth = 0; depth < 12; depth += 1) {
    const wrapper = dom.window.document.createElement('div')
    outer.replaceWith(wrapper)
    wrapper.append(outer)
    outer = wrapper
  }
  const getterCounter = { calls: 0 }
  const { candidate } = createCandidate(editor)
  attachOwner(outer, [createObservedData(candidate, getterCounter)])

  const result = collectSohuEditorPreflight({ document: dom.window.document })

  assert.equal(result.ownerCount, 1)
  assert.equal(result.slotCount, 1)
  assert.equal(result.result, 'validated')
  assert.equal(result.truncated, false)
  assert.equal(getterCounter.calls, 1)
})

test('搜狐实例预检在多个槽时零 getter 调用并报告歧义', () => {
  const dom = createPage()
  const editor = dom.window.document.querySelector('.ql-editor')
  const getterCounter = { calls: 0 }
  const { candidate } = createCandidate(editor)
  attachOwner(editor.parentElement, [
    createObservedData(candidate, getterCounter),
    createObservedData(candidate, getterCounter),
  ])

  const result = collectSohuEditorPreflight({ document: dom.window.document })

  assert.equal(result.slotCount, 2)
  assert.equal(result.getterStatus, 'not-run')
  assert.equal(result.result, 'slot-ambiguous')
  assert.equal(getterCounter.calls, 0)
})

test('搜狐实例预检区分固定 getter 抛错、API 形状不符和 root 不匹配', () => {
  const cases = [
    {
      candidate: new Error('PRIVATE GETTER ERROR'),
      expected: {
        getterStatus: 'threw',
        result: 'getter-threw',
        rootRelation: 'absent',
      },
    },
    {
      candidate: { root: null, PRIVATE_VALUE: 'PRIVATE BODY' },
      expected: {
        getterStatus: 'returned',
        result: 'api-shape-invalid',
        rootRelation: 'absent',
      },
    },
    {
      candidateFor(editor) {
        return createCandidate(editor, {
          root: editor.ownerDocument.createElement('div'),
          container: editor.ownerDocument.createElement('div'),
        }).candidate
      },
      expected: {
        getterStatus: 'returned',
        result: 'root-mismatch',
        rootRelation: 'other',
      },
    },
  ]

  for (const entry of cases) {
    const dom = createPage()
    const editor = dom.window.document.querySelector('.ql-editor')
    const getterCounter = { calls: 0 }
    const candidate = entry.candidateFor?.(editor) ?? entry.candidate
    attachOwner(editor.parentElement, [createObservedData(candidate, getterCounter)])

    const result = collectSohuEditorPreflight({ document: dom.window.document })
    const text = JSON.stringify(result)

    assert.equal(result.getterStatus, entry.expected.getterStatus)
    assert.equal(result.result, entry.expected.result)
    assert.equal(result.rootRelation, entry.expected.rootRelation)
    assert.equal(getterCounter.calls, 1)
    assert.equal(text.includes('PRIVATE'), false)
  }
})

test('搜狐实例预检没有编辑器或响应式槽时不调用任何 getter', () => {
  const noEditor = new JSDOM('<main></main>')
  assert.equal(
    collectSohuEditorPreflight({ document: noEditor.window.document }).result,
    'editor-missing',
  )

  const noSlot = createPage()
  let getterCalls = 0
  const data = {}
  Object.defineProperty(data, 'quill', {
    get() { getterCalls += 1; return null },
    set() {},
  })
  attachOwner(noSlot.window.document.querySelector('.ql-container'), [data])
  const result = collectSohuEditorPreflight({ document: noSlot.window.document })

  assert.equal(result.slotCount, 0)
  assert.equal(result.result, 'slot-missing')
  assert.equal(getterCalls, 0)
})
