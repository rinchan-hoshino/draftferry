// SPA 无刷新路由监听：优先 Navigation API 与油猴 onurlchange，兜底仅在页面可见时轻量轮询。
export function observeRoute(win, onChange) {
  const doc = win.document
  const navigation = win.navigation
  const hasNavigation = typeof navigation?.addEventListener === 'function'
  const hasUrlChange = 'onurlchange' in win
  const needsFallback = !hasNavigation && !hasUrlChange
  const cleanups = []
  let previousUrl = win.location.href
  let timer = null
  let suspended = false

  function listen(target, name, handler) {
    target.addEventListener(name, handler)
    cleanups.push(() => target.removeEventListener(name, handler))
  }

  function check() {
    const url = win.location.href
    if (url === previousUrl) return
    previousUrl = url
    onChange(url)
  }

  function stopTimer() {
    if (timer !== null) win.clearInterval(timer)
    timer = null
  }

  function resume() {
    if (suspended || doc.hidden) {
      stopTimer()
      return
    }
    check()
    if (needsFallback && timer === null) timer = win.setInterval(check, 750)
  }

  if (hasNavigation) listen(navigation, 'currententrychange', check)
  if (hasUrlChange) listen(win, 'urlchange', check)
  listen(win, 'popstate', check)
  listen(win, 'hashchange', check)
  listen(doc, 'visibilitychange', resume)
  listen(win, 'pagehide', () => { suspended = true; stopTimer() })
  listen(win, 'pageshow', () => { suspended = false; resume() })
  resume()

  return () => {
    stopTimer()
    for (const cleanup of cleanups) cleanup()
  }
}
