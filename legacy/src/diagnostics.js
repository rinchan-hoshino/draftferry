import { inspectOpenEditorRoots } from './dom-roots.js'
import {
  collectFrameworkInstances,
  isValidatedQuillApi,
} from './framework-diagnostics.js'

const DIAGNOSTIC_TAG_CATEGORIES = new Set([
  'article',
  'body',
  'div',
  'form',
  'iframe',
  'input',
  'label',
  'main',
  'p',
  'section',
  'span',
  'textarea',
])

function diagnosticTagCategory(element) {
  const tag = element?.tagName?.toLowerCase() ?? ''
  return DIAGNOSTIC_TAG_CATEGORIES.has(tag) ? tag : 'other'
}

function roundedRect(element) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function classSignals(element) {
  const signals = new Set()
  for (const className of element?.classList ?? []) {
    if (className === 'ql-container') signals.add('quill-container')
    if (className === 'ql-editor') signals.add('quill-editor')
    if (className === 'w-e-text') signals.add('wang-editor')
    if (className === 'cke') signals.add('ckeditor-root')
    if (/^cke_editor_/.test(className)) signals.add('ckeditor-wrapper')
    for (const word of ['form', 'label', 'editor', 'detail', 'content', 'item', 'row', 'control', 'field', 'market', 'product']) {
      if (className.toLowerCase().includes(word)) signals.add(`contains-${word}`)
    }
  }
  return [...signals]
}

function structuralName(element) {
  if (!element) return null
  return {
    tag: diagnosticTagCategory(element),
    classCount: element.classList?.length ?? 0,
    classSignals: classSignals(element),
  }
}

function elementSummary(element, pageWindow) {
  if (!element) return null
  const editableValue = element.getAttribute?.('contenteditable')
  const contenteditable = editableValue === null || editableValue === undefined
    ? 'absent'
    : editableValue === 'true' ? 'true' : editableValue === 'false' ? 'false' : 'other'
  let style
  try {
    const computed = pageWindow.getComputedStyle(element)
    style = {
      display: computed.display,
      visibility: computed.visibility,
    }
  } catch {
    style = { unavailable: true }
  }
  return {
    ...structuralName(element),
    contenteditable,
    hidden: Boolean(element.hidden || element.closest?.('[hidden], [aria-hidden="true"]')),
    style,
    rect: roundedRect(element),
  }
}

function ancestorPath(element, stopElement) {
  const path = []
  let node = element?.parentElement
  while (node && node !== stopElement && path.length < 8) {
    path.push(structuralName(node))
    node = node.parentElement
  }
  return path
}

function relevantOwnPropertyKinds(element) {
  if (!element) return []
  try {
    const kinds = new Set()
    for (const name of Object.getOwnPropertyNames(element)) {
      if (/quill/i.test(name)) kinds.add('quill')
      if (/editor/i.test(name)) kinds.add('editor')
      if (/react|fiber/i.test(name)) kinds.add('react-fiber')
      if (/vue/i.test(name)) kinds.add('vue')
    }
    return [...kinds]
  } catch {
    return ['unavailable']
  }
}

function safeGlobalType(pageWindow, name) {
  try {
    return typeof pageWindow[name]
  } catch {
    return '<unavailable>'
  }
}

function directLabelDescriptor(element) {
  const directText = [...element.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.nodeValue ?? '')
    .join('')
    .replace(/\s+/g, '')
  const directMarker = [...element.children].some((child) => (
    child.children.length === 0 && /^[*＊]$/.test(child.textContent?.trim() ?? '')
  ))
  const labelKind = directText.includes('产品详情')
    ? '产品详情'
    : directText.includes('商品详情') ? '商品详情' : null
  if (!labelKind) return null
  return {
    labelKind,
    hasRequiredMarker: /[*＊]/.test(directText) || directMarker,
  }
}

function labelCandidates(document) {
  const candidates = new Set(document.querySelectorAll([
    'label',
    '[class*="label"]',
    '[class*="Label"]',
    'label > span',
    '[class*="label"] > span',
    '[class*="Label"] > span',
  ].join(',')))
  return [...candidates]
}

function collectLabels(document, pageWindow) {
  return labelCandidates(document)
    .map((element) => ({ element, descriptor: directLabelDescriptor(element) }))
    .filter(({ descriptor }) => descriptor)
    .slice(0, 30)
    .map(({ element, descriptor }) => ({
      ...descriptor,
      ...elementSummary(element, pageWindow),
      ancestors: ancestorPath(element, document.body),
    }))
}

function validatedContainerQuill(container) {
  if (!container) return false
  let descriptor
  try {
    descriptor = Object.getOwnPropertyDescriptor(container, '__quill')
  } catch {
    return false
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false
  return isValidatedQuillApi(descriptor.value)
}

function collectSohu(document, pageWindow) {
  return [...document.querySelectorAll('.ql-editor')].slice(0, 20).map((editor) => {
    const container = editor.closest('.ql-container')
    return {
      editor: elementSummary(editor, pageWindow),
      editorOwnPropertyKinds: relevantOwnPropertyKinds(editor),
      container: elementSummary(container, pageWindow),
      containerOwnPropertyKinds: relevantOwnPropertyKinds(container),
      containerHasValidatedQuill: validatedContainerQuill(container),
      frameworkInstances: collectFrameworkInstances(editor),
      ancestors: ancestorPath(editor, document.body),
    }
  })
}

function ckeditorInstanceKinds(pageWindow) {
  try {
    const keys = Object.keys(pageWindow.CKEDITOR?.instances ?? {})
    return {
      count: keys.length,
      numberedEditorKeys: keys.filter((key) => /^editor\d+$/.test(key)).length,
      otherKeys: keys.filter((key) => !/^editor\d+$/.test(key)).length,
    }
  } catch {
    return { unavailable: true }
  }
}

function collectAliyun(document, pageWindow) {
  const wrappers = [...document.querySelectorAll('.cke[class*="cke_editor_"]')]
    .slice(0, 20)
    .map((element) => ({
      ...elementSummary(element, pageWindow),
      ancestors: ancestorPath(element, document.body),
    }))
  return {
    labels: collectLabels(document, pageWindow),
    formItemCounts: {
      acpn: document.querySelectorAll('.acpn-form-item').length,
      next: document.querySelectorAll('.next-form-item').length,
    },
    wrappers,
    ckeditorInstances: ckeditorInstanceKinds(pageWindow),
  }
}

function collectTencent(document, pageWindow) {
  let runtimeDocument = document
  try {
    runtimeDocument = pageWindow.document ?? document
  } catch {
    // The safe sandbox document remains useful if the page bridge is unavailable.
  }
  const inspection = inspectOpenEditorRoots(runtimeDocument)
  const rootCounts = {
    document: 0,
    shadowRoot: 0,
    iframeDocument: 0,
  }
  const roots = inspection.entries.map(({ root, kind }, rootIndex) => {
    rootCounts[kind] += 1
    const rootDocument = root.ownerDocument ?? root
    const rootWindow = rootDocument.defaultView ?? pageWindow
    const wangEditors = [...root.querySelectorAll('.w-e-text')]
    const editableCandidates = [...new Set(root.querySelectorAll(
      '[contenteditable]:not([contenteditable="false"]), textarea, [role="textbox"]',
    ))].filter((element) => !element.matches('.w-e-text'))
    return {
      rootIndex,
      kind,
      labels: collectLabels(root, rootWindow),
      wangEditors: wangEditors.slice(0, 20).map((element) => ({
        ...elementSummary(element, rootWindow),
        frameworkInstances: collectFrameworkInstances(element),
        ancestors: ancestorPath(element, rootDocument.body),
      })),
      editableCandidates: editableCandidates.slice(0, 20).map((element) => ({
        ...elementSummary(element, rootWindow),
        ancestors: ancestorPath(element, rootDocument.body),
      })),
      editableCandidateCount: editableCandidates.length,
    }
  })
  return {
    rootCounts,
    inaccessibleIframeCount: inspection.inaccessibleIframeCount,
    truncated: inspection.truncated,
    roots,
  }
}

export function collectPlatformDiagnostics({
  document,
  pageWindow = document.defaultView,
  platformId,
  version,
}) {
  const diagnostics = {
    schema: 3,
    draftferryVersion: version,
    platformId,
    pageBridge: pageWindow !== document.defaultView,
    pageDocumentMatches: pageWindow.document === document,
    globals: {
      Quill: safeGlobalType(pageWindow, 'Quill'),
      CKEDITOR: safeGlobalType(pageWindow, 'CKEDITOR'),
      UE_V2: safeGlobalType(pageWindow, 'UE_V2'),
    },
  }
  if (platformId === 'sohu') diagnostics.sohu = collectSohu(document, pageWindow)
  if (platformId === 'aliyun-market') diagnostics.aliyun = collectAliyun(document, pageWindow)
  if (platformId === 'tencent-market') diagnostics.tencent = collectTencent(document, pageWindow)
  return JSON.stringify(diagnostics, null, 2)
}
