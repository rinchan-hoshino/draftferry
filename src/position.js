const STORAGE_KEY = 'draftferry.panel-position'
const DEFAULT_POSITION = { x: 1, y: 0.5 }
const MARGIN = 16
const clamp = value => Math.max(0, Math.min(1, value))

export function attachPanelPosition(host, handles, onMove = () => {}) {
  const win = host.ownerDocument.defaultView
  let position = { ...DEFAULT_POSITION }
  let drag = null
  const cleanups = []

  try {
    const saved = JSON.parse(win.localStorage.getItem(STORAGE_KEY))
    if (saved && ['x', 'y'].every(k => Number.isFinite(saved[k]) && saved[k] >= 0 && saved[k] <= 1)) {
      position = { x: saved.x, y: saved.y }
    }
  } catch { /* localStorage 不可用时仍支持当前会话拖动 */ }

  function bounds() {
    const rect = host.getBoundingClientRect()
    return {
      width: Math.max(0, win.innerWidth - rect.width - MARGIN * 2),
      height: Math.max(0, win.innerHeight - rect.height - MARGIN * 2),
    }
  }

  function apply() {
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    host.style.left = `calc(${MARGIN}px + (100vw - ${MARGIN * 2}px) * ${position.x})`
    host.style.top = `calc(${MARGIN}px + (100dvh - ${MARGIN * 2}px) * ${position.y})`
    host.style.transform = `translate(${-position.x * 100}%, ${-position.y * 100}%)`
  }

  function save() {
    try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(position)) } catch { /* ignore */ }
  }

  function moveTo(left, top) {
    const { width, height } = bounds()
    position = {
      x: width ? clamp((left - MARGIN) / width) : position.x,
      y: height ? clamp((top - MARGIN) / height) : position.y,
    }
    apply()
  }

  function listen(target, name, handler) {
    target.addEventListener(name, handler)
    cleanups.push(() => target.removeEventListener(name, handler))
  }

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    const { handle, pointerId } = drag
    drag = null
    handle.classList.remove('dragging')
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
    save()
  }

  for (const handle of handles) {
    listen(handle, 'pointerdown', (event) => {
      if (event.button !== 0 || event.isPrimary === false || drag) return
      try { handle.setPointerCapture(event.pointerId) } catch { return }
      event.preventDefault()
      onMove()
      const rect = host.getBoundingClientRect()
      drag = { handle, pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top }
      handle.classList.add('dragging')
    })
    listen(handle, 'pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      moveTo(event.clientX - drag.dx, event.clientY - drag.dy)
    })
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(handle, name, endDrag)
    listen(handle, 'keydown', (event) => {
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

  listen(win, 'resize', onMove)
  apply()

  return {
    reset() { endDrag(); position = { ...DEFAULT_POSITION }; apply(); save() },
    destroy() { endDrag(); for (const cleanup of cleanups) cleanup() },
  }
}
