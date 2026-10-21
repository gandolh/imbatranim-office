import { useCallback, useEffect, useRef, useState } from 'react'
import { useElementSize } from '@imbatranim/ui'
import type { SlideModel } from '../engine/model'
import { SlideView } from '../view/SlideView'
import { BASE_WIDTH, slideHeight } from '../view/slideMetrics'

type Props = {
  count: number
  start: number
  model: (index: number) => SlideModel | null
  onExit: (lastIndex: number) => void
}

/**
 * The slide show: fullscreen, one slide fitted to the screen, black around
 * it. Click, Space, Enter, → / ↓ / PageDown go forward; ← / ↑ / PageUp /
 * Backspace go back; Home and End jump; B blacks the screen; Escape leaves.
 * Hidden slides are skipped. When the browser refuses fullscreen it presents
 * in the window instead, and Escape still leaves.
 */
export function Presenter({ count, start, model, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [size, attachSize] = useElementSize()
  const [index, setIndex] = useState(start)
  const [black, setBlack] = useState(false)
  const indexRef = useRef(index)
  useEffect(() => {
    indexRef.current = index
  })

  const visible = useCallback(
    (from: number, step: 1 | -1): number => {
      for (let i = from; i >= 0 && i < count; i += step) if (!model(i)?.hidden) return i
      return -1
    },
    [count, model]
  )

  const go = useCallback(
    (step: 1 | -1) => {
      setBlack(false)
      setIndex((i) => {
        const next = visible(i + step, step)
        return next < 0 ? i : next
      })
    },
    [visible]
  )

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
    onExit(indexRef.current)
  }, [onExit])

  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      hostRef.current = el
      if (el) void el.requestFullscreen?.().catch(() => undefined)
      return attachSize(el)
    },
    [attachSize]
  )

  // Leaving fullscreen by the browser's own means ends the show too.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && hostRef.current) onExit(indexRef.current)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [onExit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          exit()
          break
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
        case 'n':
          e.preventDefault()
          go(1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
        case 'p':
          e.preventDefault()
          go(-1)
          break
        case 'Home':
          e.preventDefault()
          setIndex(Math.max(0, visible(0, 1)))
          break
        case 'End':
          e.preventDefault()
          setIndex(Math.max(0, visible(count - 1, -1)))
          break
        case 'b':
        case '.':
          e.preventDefault()
          setBlack((b) => !b)
          break
        default:
          return
      }
      e.stopPropagation()
    }
    // Capture: the show owns the keyboard while it runs.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [count, exit, go, visible])

  const m = model(index)
  const fit =
    m && size.width > 0 ? Math.min(size.width / BASE_WIDTH, size.height / slideHeight(m)) : 0

  return (
    <div
      ref={attach}
      role="dialog"
      aria-label="Slide show"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black"
      onClick={() => go(1)}
    >
      {m && fit > 0 && !black && (
        <div
          style={{ width: BASE_WIDTH * fit, height: slideHeight(m) * fit, position: 'relative' }}
        >
          <div
            style={{
              transform: `scale(${fit})`,
              transformOrigin: '0 0',
              position: 'absolute',
              left: 0,
              top: 0,
            }}
          >
            <SlideView model={m} />
          </div>
        </div>
      )}
      <span className="font-ui pointer-events-none fixed right-4 bottom-3 text-[12px] text-white/70 tabular-nums">
        {index + 1} / {count}
      </span>
      <button
        type="button"
        aria-label="Exit presenting"
        onClick={(e) => {
          e.stopPropagation()
          exit()
        }}
        className="font-ui fixed top-3 right-4 border border-white/30 px-2 py-0.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
      >
        Exit (Esc)
      </button>
    </div>
  )
}
