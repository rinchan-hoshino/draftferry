export function buildDiagnostic({ version, pageUrl, ueditorFound, titleFound, error = null }) {
  return JSON.stringify({
    scriptVersion: version,
    pageUrl,
    ueditorFound: Boolean(ueditorFound),
    titleFound: Boolean(titleFound),
    error: error ? { message: error.message || String(error), stack: error.stack ?? null } : null,
  }, null, 2)
}
