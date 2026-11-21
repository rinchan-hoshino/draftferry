const STORAGE_KEY = 'folio.panel-position'
const DEFAULT_POSITION = { x: 1, y: 0.5 }
const MARGIN = 16
const clamp = (value: number): number => Math.max(0, Math.min(1, value))

export interface PositionController {
  reset: () => void
  destroy: () => void
}

interface DragState {
  handle: HTMLElement
  pointerId: number
  dx: number
  dy: number
}

export function attachPanelPosition(
  host: HTMLElement,
  handles: HTMLElement[],
  onMove: () => void = () => {},
): PositionController {
  const win = host.ownerDocument.defaultView!
  let position = { ...DEFAULT_POSITION }
  let drag: DragState | null = null
  const cleanups: Array<() => void> = []

  try {
    const raw = win.localStorage.getItem(STORAGE_KEY)
    const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    if (
      saved &&
      typeof saved.x === 'number' &&
      typeof saved.y === 'number' &&
      Number.isFinite(saved.x) &&
      Number.isFinite(saved.y) &&
      saved.x >= 0 &&
      saved.x <= 1 &&
      saved.y >= 0 &&
      saved.y <= 1
    ) {
      position = { x: saved.x, y: saved.y }
    }
  } catch {
    /* localStorage unavailable */
  }

  function bounds(): { width: number; height: number } {
    const rect = host.getBoundingClientRect()
    return {
      width: Math.max(0, win.innerWidth - rect.width - MARGIN * 2),
      height: Math.max(0, win.innerHeight - rect.height - MARGIN * 2),
    }
  }

  function apply(): void {
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    host.style.left = `calc(${MARGIN}px + (100vw - ${MARGIN * 2}px) * ${position.x})`
    host.style.top = `calc(${MARGIN}px + (100dvh - ${MARGIN * 2}px) * ${position.y})`
    host.style.transform = `translate(${-position.x * 100}%, ${-position.y * 100}%)`
  }

  function save(): void {
    try {
      win.localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
    } catch {
      /* ignore */
    }
  }

  function moveTo(left: number, top: number): void {
    const { width, height } = bounds()
    position = {
      x: width ? clamp((left - MARGIN) / width) : position.x,
      y: height ? clamp((top - MARGIN) / height) : position.y,
    }
    apply()
  }

  function listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    name: K | string,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(name, handler as EventListener)
    cleanups.push(() => target.removeEventListener(name, handler as EventListener))
  }

  function endDrag(event?: PointerEvent): void {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    const { handle, pointerId } = drag
    drag = null
    handle.classList.remove('dragging')
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
    save()
  }

  for (const handle of handles) {
    listen(handle, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || drag) return
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        return
      }
      event.preventDefault()
      onMove()
      const rect = host.getBoundingClientRect()
      drag = {
        handle,
        pointerId: event.pointerId,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
      }
      handle.classList.add('dragging')
    })
    listen(handle, 'pointermove', (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      moveTo(event.clientX - drag.dx, event.clientY - drag.dy)
    })
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      listen(handle, name, endDrag)
    }
    listen(handle, 'keydown', (event: KeyboardEvent) => {
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      const direction = directions[event.key]
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
    reset() {
      endDrag()
      position = { ...DEFAULT_POSITION }
      apply()
      save()
    },
    destroy() {
      endDrag()
      for (const cleanup of cleanups) cleanup()
    },
  }
}
