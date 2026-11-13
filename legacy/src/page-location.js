// Observe SPA routes without replacing the host's history methods or watching
// its entire DOM. Old browsers need only a cheap URL comparison while visible.
export function observePageLocation(windowObject, onChange) {
  const document = windowObject.document
  const navigation = windowObject.navigation
  const hasNavigation = typeof navigation?.addEventListener === 'function'
  const hasUrlChange = 'onurlchange' in windowObject
  const needsFallback = !hasNavigation && !hasUrlChange
  const cleanups = []
  let previousUrl = windowObject.location.href
  let timer = null
  let suspended = false

  function listen(target, name, callback) {
    target.addEventListener(name, callback)
    cleanups.push(() => target.removeEventListener(name, callback))
  }

  function check() {
    const url = windowObject.location.href
    if (url === previousUrl) return
    previousUrl = url
    onChange()
  }

  function stopTimer() {
    if (timer !== null) windowObject.clearInterval(timer)
    timer = null
  }

  function resume() {
    if (suspended || document.hidden) { stopTimer(); return }
    check()
    if (needsFallback && timer === null) timer = windowObject.setInterval(check, 750)
  }

  if (hasNavigation) listen(navigation, 'currententrychange', check)
  if (hasUrlChange) listen(windowObject, 'urlchange', check)
  listen(windowObject, 'popstate', check)
  listen(windowObject, 'hashchange', check)
  listen(document, 'visibilitychange', resume)
  listen(windowObject, 'pagehide', () => { suspended = true; stopTimer() })
  listen(windowObject, 'pageshow', () => { suspended = false; resume() })
  resume()

  return () => {
    stopTimer()
    for (const cleanup of cleanups) cleanup()
  }
}
