/**
 * Thumbnails panel — a lazy grid of page previews. Each thumb rasterises only
 * once it scrolls near the panel viewport (IntersectionObserver), so a big
 * document doesn't render every page up front. Click a thumb to jump.
 *
 * Drawn with the reader's `render` (pdf.js), so the rail does not wait for the
 * engine; the panel itself mounts only after the first page (SidePanel).
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Render } from '@pdfcore/engine'
import { useReader } from '../app/context'

const THUMB_W = 132

interface ThumbProps {
  render: Render
  pageNumber: number
  aspect: number // h / w
  active: boolean
  epoch: number
  onClick: () => void
}

function Thumb({ render, pageNumber, aspect, active, epoch, onClick }: ThumbProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [seen, setSeen] = useState(false)
  const height = Math.round(THUMB_W * aspect)
  // Serialises draws onto this canvas, as PageView does: pdf.js refuses a
  // second render() onto a canvas still being drawn, and an edit (rotate,
  // reorder) re-draws every thumb while the previous draw may still be running.
  const drawChain = useRef<Promise<unknown>>(Promise.resolve())

  // Reveal when near the viewport.
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { root: el.closest('[data-panel-scroll]'), rootMargin: '300px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  // Scroll the active thumb into view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useEffect(() => {
    if (!seen) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const draw = async () => {
      if (cancelled) return
      try {
        const vp = await render.viewport(pageNumber, { scale: 1 })
        if (cancelled) return
        const scale = (THUMB_W * (window.devicePixelRatio || 1)) / vp.width
        await render.page(pageNumber, canvas, { scale })
      } catch {
        /* leave the placeholder */
      }
    }
    drawChain.current = drawChain.current.then(draw, draw)
    return () => {
      cancelled = true
    }
  }, [render, pageNumber, seen, epoch])

  return (
    <button
      ref={ref}
      type="button"
      className={
        'group flex flex-col items-center gap-1 p-1 ' +
        (active ? 'bg-primary-container' : 'hover:bg-surface-container-high')
      }
      onClick={onClick}
      aria-label={`Page ${pageNumber}`}
      aria-current={active}
    >
      <span
        className={
          'grid place-items-center bg-white ' +
          (active ? 'ring-primary ring-2' : 'ring-outline-variant ring-1')
        }
        style={{ width: THUMB_W, height }}
      >
        {seen ? (
          <canvas ref={canvasRef} className="block h-full w-full" />
        ) : (
          <span className="bg-surface-container-high block h-full w-full animate-pulse" />
        )}
      </span>
      <span
        className={
          'text-[10px] tabular-nums ' +
          (active ? 'text-on-primary-container' : 'text-on-surface-variant')
        }
      >
        {pageNumber}
      </span>
    </button>
  )
}

export function ThumbnailsPanel(): JSX.Element {
  const { render, pageCount, pageDims, currentPage, goToPage, renderEpoch } = useReader()

  if (!render)
    return <div className="text-on-surface-variant p-3 text-center text-[11px]">No document.</div>

  return (
    <div className="flex flex-col items-center gap-1.5 p-2">
      {Array.from({ length: pageCount }, (_, i) => {
        const d = pageDims[i] ?? { w: 612, h: 792 }
        return (
          <Thumb
            key={i + 1}
            render={render}
            pageNumber={i + 1}
            aspect={d.h / d.w}
            active={currentPage === i + 1}
            epoch={renderEpoch}
            onClick={() => goToPage(i + 1)}
          />
        )
      })}
    </div>
  )
}
