const STORAGE_KEY = 'draftferry.panel-position'
const DEFAULT_POSITION = { x: 1, y: 0.5 }
const MARGIN = 16
const clamp = value => Math.max(0, Math.min(1, value))

// Coordinates are fractions of the available viewport, so expanding the panel
// or resizing the window never strands its controls outside the page.
export function attachPanelPosition(host, handles, onMove = () => {}) {
  const window = host.ownerDocument.defaultView
  let position = { ...DEFAULT_POSITION }
  let drag = null
  const cleanups = []
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY))
    if (saved && ['x', 'y'].every(key => Number.isFinite(saved[key]) && saved[key] >= 0 && saved[key] <= 1)) position = { x: saved.x, y: saved.y }
  } catch { /* Storage may be disabled; moving still works for this page. */ }

  function bounds() {
    const rect = host.getBoundingClientRect()
    return { width: Math.max(0, window.innerWidth - rect.width - MARGIN * 2), height: Math.max(0, window.innerHeight - rect.height - MARGIN * 2) }
  }

  function apply() {
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    // Let layout apply viewport and panel size changes synchronously. There is
    // no resize observer or frame in which the old pixel position is offscreen.
    host.style.left = `calc(${MARGIN}px + (100vw - ${MARGIN * 2}px) * ${position.x})`
    host.style.top = `calc(${MARGIN}px + (100dvh - ${MARGIN * 2}px) * ${position.y})`
    host.style.transform = `translate(${-position.x * 100}%, ${-position.y * 100}%)`
  }

  function save() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position)) } catch { /* Optional preference only. */ }
  }

  function moveTo(left, top) {
    const { width, height } = bounds()
    position = { x: width ? clamp((left - MARGIN) / width) : position.x, y: height ? clamp((top - MARGIN) / height) : position.y }
    apply()
  }

  function listen(target, name, callback) {
    target.addEventListener(name, callback)
    cleanups.push(() => target.removeEventListener(name, callback))
  }

  function endDrag(event) {
    if (!drag || event && event.pointerId !== drag.pointerId) return
    const { handle, pointerId } = drag
    drag = null
    handle.classList.remove('dragging')
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
    save()
  }

  for (const handle of handles) {
    listen(handle, 'pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || drag) return
      // Capturing on the handle avoids page-wide mouse/touch listeners.
      try { handle.setPointerCapture(event.pointerId) } catch { return }
      event.preventDefault()
      onMove()
      const rect = host.getBoundingClientRect()
      drag = { handle, pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top }
      handle.classList.add('dragging')
    })
    listen(handle, 'pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return
      moveTo(event.clientX - drag.dx, event.clientY - drag.dy)
    })
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(handle, name, endDrag)
    listen(handle, 'keydown', event => {
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
      if (!direction || event.altKey || event.ctrlKey || event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      onMove()
      const rect = host.getBoundingClientRect()
      const step = event.shiftKey ? 40 : 10
      moveTo(rect.left + direction[0] * step, rect.top + direction[1] * step)
      save()
    })
  }

  listen(window, 'resize', onMove)
  apply()
  return {
    reset() { endDrag(); position = { ...DEFAULT_POSITION }; apply(); save() },
    destroy() { endDrag(); for (const cleanup of cleanups) cleanup() },
  }
}
