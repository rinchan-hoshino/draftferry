import { collectPlatformDiagnostics } from './diagnostics.js'
import { collectSohuEditorPreflight } from './sohu-preflight.js'
import { collectSafeDomMap } from './safe-dom-map.js'

function safeFilenamePart(value, fallback) {
  const safe = String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48)
  return safe || fallback
}

function timestampForFilename(now) {
  const iso = now.toISOString()
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`
}

export function buildDiagnosticFile({
  document,
  pageWindow,
  platformId,
  version,
  generatedAt = new Date().toISOString(),
} = {}) {
  const diagnostics = JSON.parse(collectPlatformDiagnostics({
    document,
    pageWindow,
    platformId,
    version,
  }))
  const report = {
    fileSchema: 1,
    generatedAt,
    diagnostics,
    safeDomMap: collectSafeDomMap(document),
  }
  if (platformId === 'sohu') {
    report.sohuEditorPreflight = collectSohuEditorPreflight({ document, version })
  }
  return JSON.stringify(report, null, 2)
}

export function downloadDiagnosticFile({
  windowObject,
  document,
  text,
  platformId,
  version,
  now = new Date(),
} = {}) {
  const filename = [
    'draftferry-diagnostic',
    safeFilenamePart(platformId, 'unknown'),
    safeFilenamePart(version, 'unknown'),
    timestampForFilename(now),
  ].join('-') + '.txt'
  const blob = new windowObject.Blob([text], { type: 'text/plain;charset=utf-8' })
  const objectUrl = windowObject.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  try {
    // A detached anchor still downloads in Chrome, without bubbling through the
    // host page's delegated link handlers (which can navigate to the blob URL).
    link.click()
  } catch (error) {
    windowObject.URL.revokeObjectURL(objectUrl)
    throw error
  }
  // Let the browser acquire the blob before releasing it. Revoking in the same
  // click task can invalidate an asynchronous download.
  windowObject.setTimeout(() => windowObject.URL.revokeObjectURL(objectUrl), 60_000)
  return filename
}
