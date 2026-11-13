import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { findLiveEditor, findTitleControl, fillTitle, writeBody } from '../src/editor.js'

function fakeEditor(connected = true) {
  let content = ''
  return {
    body: { isConnected: connected },
    iframe: { isConnected: connected },
    getContent: () => content,
    setContent: (html) => { content = html },
    fireEvent() {},
  }
}

test('findLiveEditor takes the highest-numbered connected instance', () => {
  const pageWindow = { UE_V2: { instants: {
    ueditorInstant0: fakeEditor(false),
    ueditorInstant1: fakeEditor(true),
    ueditorInstant2: fakeEditor(false),
  } } }
  assert.equal(findLiveEditor(pageWindow), pageWindow.UE_V2.instants.ueditorInstant1)
  assert.equal(findLiveEditor({}), null)
})

test('title control is found through the known selectors', () => {
  const { window } = new JSDOM('<div class="client_components_titleInput"><div contenteditable="true"></div></div>')
  assert.ok(findTitleControl(window.document))
  assert.equal(findTitleControl(new JSDOM('<p></p>').window.document), null)
})

test('fillTitle falls back to input events and reads the value back', () => {
  const { window } = new JSDOM('<div class="client_components_titleInput"><div contenteditable="true"></div></div>')
  const control = window.document.querySelector('[contenteditable]')
  let inputs = 0
  control.addEventListener('input', () => { inputs += 1 })
  fillTitle(window, control, '新标题')
  assert.equal(control.textContent, '新标题')
  assert.equal(inputs, 1)
})

test('writeBody clears, writes and rejects a short read-back', () => {
  const editor = fakeEditor()
  writeBody(editor, '<p>正文一段</p>')
  assert.equal(editor.getContent(), '<p>正文一段</p>')
  const broken = { ...fakeEditor(), getContent: () => '' }
  assert.throws(() => writeBody(broken, '<p>很长很长的正文</p>'), /读回长度不对/)
})
