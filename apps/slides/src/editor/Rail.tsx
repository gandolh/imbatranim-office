import { useEffect, useRef, useState } from 'react'
import { cn } from '@imbatranim/ui'
import type { SlideModel } from '../engine/model'
import { SlideView } from '../view/SlideView'
import { BASE_WIDTH, slideHeight } from '../view/slideMetrics'

const THUMB_WIDTH = 132

type Props = {
  count: number
  current: number
  model: (index: number) => SlideModel | null
  /** Bumps whenever the deck changes, so thumbnails redraw. */
  version: number
  onSelect: (index: number) => void
  onMove: (from: number, to: number) => void
  onDelete: (index: number) => void
  onContextMenu: (x: number, y: number, index: number) => void
}

/**
 * The slide rail: a live thumbnail per slide (the same renderer as the
 * stage, scaled down), drag to reorder, right-click for the slide menu.
 * Keys while a thumbnail has focus: arrows move between slides,
 * Ctrl+arrows move the slide, Delete removes it.
 */
export function Rail({
  count,
  current,
  model,
  version,
  onSelect,
  onMove,
  onDelete,
  onContextMenu,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ from: number; startY: number; active: boolean } | null>(null)
  /** The click that ends a drag is not a selection. */
  const justDragged = useRef(false)
  const [dropAt, setDropAt] = useState<number | null>(null)

  // Keep the current slide in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const indexAt = (clientY: number): number => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-index]') ?? [])]
    for (const el of items) {
      const r = el.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return Number(el.dataset.index)
    }
    return items.length
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Slides"
      className="border-outline-variant bg-surface-container-low w-[152px] shrink-0 overflow-y-auto border-r"
    >
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="relative">
            {dropAt === i && (
              <div className="bg-primary absolute -top-[5px] right-0 left-0 h-[2px]" />
            )}
            <button
              type="button"
              role="option"
              data-index={i}
              aria-selected={i === current}
              aria-label={`Slide ${i + 1}`}
              onClick={() => {
                if (justDragged.current) {
                  justDragged.current = false
                  return
                }
                onSelect(i)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                onSelect(i)
                onContextMenu(e.clientX, e.clientY, i)
              }}
              onKeyDown={(e) => {
                const mod = e.ctrlKey || e.metaKey
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const to = i + (e.key === 'ArrowDown' ? 1 : -1)
                  if (to < 0 || to >= count) return
                  if (mod) onMove(i, to)
                  onSelect(to)
                  requestAnimationFrame(() =>
                    listRef.current?.querySelector<HTMLElement>(`[data-index="${to}"]`)?.focus()
                  )
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault()
                  onDelete(i)
                }
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                drag.current = { from: i, startY: e.clientY, active: false }
                try {
                  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                } catch {
                  // An untracked pointer: the drag still works over the rail.
                }
              }}
              onPointerMove={(e) => {
                const d = drag.current
                if (!d) return
                if (!d.active && Math.abs(e.clientY - d.startY) < 6) return
                d.active = true
                setDropAt(indexAt(e.clientY))
              }}
              onPointerUp={(e) => {
                const d = drag.current
                drag.current = null
                setDropAt(null)
                if (!d?.active) return
                justDragged.current = true
                const at = indexAt(e.clientY)
                // Dropping below itself shifts the target by the slide's own slot.
                const to = at > d.from ? at - 1 : at
                if (to !== d.from) onMove(d.from, Math.max(0, Math.min(count - 1, to)))
              }}
              onPointerCancel={() => {
                drag.current = null
                setDropAt(null)
              }}
              className={cn(
                'group relative block w-full overflow-hidden border text-left',
                'focus-visible:ring-primary outline-none focus-visible:ring-2',
                i === current
                  ? 'border-primary'
                  : 'border-outline-variant hover:border-on-surface-variant'
              )}
            >
              <Thumb index={i} model={model} version={version} />
              <span
                className={cn(
                  'font-ui absolute right-0 bottom-0 px-1 text-[10px] tabular-nums',
                  i === current
                    ? 'bg-primary text-on-primary'
                    : 'bg-inverse-surface text-inverse-on-surface'
                )}
              >
                {i + 1}
              </span>
            </button>
          </div>
        ))}
        {dropAt === count && <div className="bg-primary h-[2px]" />}
      </div>
    </div>
  )
}

/** One thumbnail, drawn only once it scrolls into view (a long deck stays cheap). */
function Thumb({
  index,
  model,
  version,
}: {
  index: number
  model: (i: number) => SlideModel | null
  version: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || visible || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  const m = visible ? model(index) : null
  void version
  const aspect = m ? slideHeight(m) / BASE_WIDTH : 0.5625
  const scale = THUMB_WIDTH / BASE_WIDTH
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="bg-surface-container-lowest relative w-full overflow-hidden"
      style={{ height: Math.round(THUMB_WIDTH * aspect) }}
    >
      {m && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            pointerEvents: 'none',
          }}
        >
          <SlideView model={m} />
        </div>
      )}
      {m?.hidden && <div className="bg-surface-container-lowest/60 absolute inset-0" />}
    </div>
  )
}
