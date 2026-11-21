// SPA route listener: prefers Navigation API and Tampermonkey onurlchange,
// falling back to lightweight polling only when the page is visible.
export function observeRoute(win: Window, onChange: (url: string) => void): () => void {
  const doc = win.document
  const navigation = (win as unknown as { navigation?: EventTarget }).navigation
  const hasNavigation = typeof navigation?.addEventListener === 'function'
  const hasUrlChange = 'onurlchange' in win
  const needsFallback = !hasNavigation && !hasUrlChange
  const cleanups: Array<() => void> = []
  let previousUrl = win.location.href
  let timer: number | null = null
  let suspended = false

  function listen(target: EventTarget, name: string, handler: EventListener): void {
    target.addEventListener(name, handler)
    cleanups.push(() => target.removeEventListener(name, handler))
  }

  function check(): void {
    const url = win.location.href
    if (url === previousUrl) return
    previousUrl = url
    onChange(url)
  }

  function stopTimer(): void {
    if (timer !== null) win.clearInterval(timer)
    timer = null
  }

  function resume(): void {
    if (suspended || doc.hidden) {
      stopTimer()
      return
    }
    check()
    if (needsFallback && timer === null) timer = win.setInterval(check, 750)
  }

  if (hasNavigation && navigation) listen(navigation, 'currententrychange', check)
  if (hasUrlChange) listen(win, 'urlchange', check)
  listen(win, 'popstate', check)
  listen(win, 'hashchange', check)
  listen(doc, 'visibilitychange', resume)
  listen(win, 'pagehide', () => {
    suspended = true
    stopTimer()
  })
  listen(win, 'pageshow', () => {
    suspended = false
    resume()
  })
  resume()

  return () => {
    stopTimer()
    for (const cleanup of cleanups) cleanup()
  }
}
