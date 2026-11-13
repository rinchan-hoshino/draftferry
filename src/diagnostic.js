export function buildDiagnostic({ version, pageUrl, platformId, editorFound, titleFound, error = null }) {
  return JSON.stringify({
    scriptVersion: version,
    pageUrl,
    platformId: platformId ?? null,
    editorFound: Boolean(editorFound),
    titleFound: Boolean(titleFound),
    error: error ? { message: error.message || String(error), stack: error.stack ?? null } : null,
  }, null, 2)
}
