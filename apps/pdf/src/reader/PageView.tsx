/**
 * A single rendered page: the rasterised canvas (Render), the engine's
 * selectable/copyable text layer (`buildTextLayer`) laid over it, and a
 * search-highlight overlay. Only mounted for pages inside the Reader's virtual
 * window, so a large document never eagerly rasterises every page.
 *
 * The canvas needs only `render` (pdf.js), so a page draws before the engine
 * has loaded. The text layer and the annotation overlay need the engine
 * (`doc` + `engine`) and appear when it arrives, without the page being drawn
 * again: the engine's `doc.render` is this same `render`.
 *
 * Coordinate handling:
 *  • `scale` maps PDF points → CSS px (what zoom/fit sets).
 *  • the canvas is rasterised at `scale × devicePixelRatio` for crispness, then
 *    CSS-sized down to `scale` px.
 *  • the text layer + search overlay use the viewport at `scale` so their boxes
 *    align to the CSS-sized canvas.
 *
 * ── PART B SEAM ────────────────────────────────────────────────────────────
 * The `vp` (PageViewport) is available once a page renders; Part B mounts its
 * per-page annotation overlay below, sized to the sheet and driven by the same
 * viewport the text layer uses.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  DomDocumentLike,
  DomElementLike,
  PageViewport,
  PdfDoc,
  Rect,
  Render,
  TextHit,
  TextLayerHandle,
} from '@pdfcore/engine'
import type { Engine } from '../app/engine'
import { PageAnnotateLayer } from '../lazy'

const MAX_DPR = 2

/** Every search hit on a page (the engine text layer's highlight marks). */
const HIT_CLASS = 'bg-primary/25 mix-blend-multiply'

export interface PageViewProps {
  /** The page renderer (pdf.js). */
  render: Render
  /** The engine's document, once loaded: the text layer and the overlay need it. */
  doc: PdfDoc | null
  engine: Engine | null
  /** 1-based page number. */
  pageNumber: number
  /** CSS px width/height for this page at the current scale (layout box). */
  width: number
  height: number
  /** Points → CSS px scale. */
  scale: number
  /** Bumped by the controller to force a re-render/rebuild after an edit. */
  renderEpoch: number
  /** Search hits located on this page (base highlight). */
  hits: TextHit[]
  /** The rects of the active hit, if it is on this page (focus ring). */
  activeRects: Rect[] | null
  /** Report the page's true (rotation-corrected) point size after first render. */
  onMeasured: (index0: number, w: number, h: number) => void
  /** The page has been drawn, or has failed to: the rest of the app may load. */
  onPainted: () => void
}

export function PageView({
  render,
  doc,
  engine,
  pageNumber,
  width,
  height,
  scale,
  renderEpoch,
  hits,
  activeRects,
  onMeasured,
  onPainted,
}: PageViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textHostRef = useRef<HTMLDivElement>(null)
  const [textLayer, setTextLayer] = useState<TextLayerHandle | null>(null)
  // Serialises render.page() calls for this canvas — pdf.js rejects two
  // concurrent render()s onto the same canvas (esp. under StrictMode).
  const renderChain = useRef<Promise<unknown>>(Promise.resolve())
  const [vp, setVp] = useState<PageViewport | null>(null)
  const [failed, setFailed] = useState(false)

  // (Re)draw whenever the renderer, page, scale, or render epoch changes.
  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    const run = async () => {
      try {
        const viewport = await render.viewport(pageNumber, { scale })
        if (cancelled) return
        // Report the rotation-corrected point size (viewport px ÷ scale).
        onMeasured(
          pageNumber - 1,
          viewport.width / viewport.scale,
          viewport.height / viewport.scale
        )

        const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
        await render.page(pageNumber, canvas, { scale: scale * dpr })
        if (cancelled) return
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        setVp(viewport)
        setFailed(false)
        onPainted()
      } catch (err) {
        if (!cancelled) {
          setFailed(true)
          onPainted()
          console.error(`render page ${pageNumber} failed`, err)
        }
      }
    }

    // Chain so this instance never has two overlapping render.page() calls.
    renderChain.current = renderChain.current.then(run, run)

    return () => {
      cancelled = true
    }
  }, [render, pageNumber, scale, renderEpoch, onMeasured, onPainted])

  // The selectable text layer, aligned to the drawn viewport. It needs the
  // engine's text extraction, so it follows the canvas rather than delaying it.
  useEffect(() => {
    const host = textHostRef.current
    if (!host || !vp || !doc || !engine) return
    let cancelled = false
    let handle: TextLayerHandle | null = null
    void (async () => {
      try {
        const items = await doc.text.extract({ pages: [pageNumber] })
        if (cancelled) return
        host.style.width = `${vp.width}px`
        host.style.height = `${vp.height}px`
        handle = engine.buildTextLayer({
          // The engine types these structurally (DomDocumentLike/DomElementLike)
          // to stay free of lib.dom; the real DOM nodes satisfy that surface.
          document: document as unknown as DomDocumentLike,
          container: host as unknown as DomElementLike,
          items,
          viewport: vp,
        })
        setTextLayer(handle)
      } catch (err) {
        if (!cancelled) console.error(`text layer for page ${pageNumber} failed`, err)
      }
    })()
    return () => {
      cancelled = true
      handle?.destroy()
      setTextLayer((cur) => (cur === handle ? null : cur))
    }
  }, [doc, engine, pageNumber, vp, renderEpoch])

  // Base search highlight — drive the engine text layer's highlightRects with
  // every hit on this page.
  useEffect(() => {
    if (!textLayer) return
    if (hits.length) {
      textLayer.highlightRects(
        hits.flatMap((h) => h.rects),
        { className: HIT_CLASS }
      )
    } else {
      textLayer.clearHighlights()
    }
  }, [hits, textLayer])

  // Active-hit focus ring — rendered as React nodes so it can layer above the
  // base fill. Uses the engine's layoutHighlightRects helper.
  const activeBoxes = useMemo(() => {
    if (!vp || !engine || !activeRects || !activeRects.length) return []
    return engine.layoutHighlightRects(activeRects, vp)
  }, [vp, engine, activeRects])

  return (
    <div className="relative" data-page={pageNumber} style={{ width, height }}>
      <div
        className="ring-outline-variant relative overflow-hidden bg-white shadow-md ring-1"
        style={{ width, height }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block" />
        <div
          ref={textHostRef}
          className="pdfcore-text-layer selection:bg-primary/40 absolute inset-0"
        />
        <div className="pointer-events-none absolute inset-0 z-[3]" aria-hidden="true">
          {activeBoxes.map((b, i) => (
            <span
              key={i}
              className="bg-primary/35 ring-primary absolute mix-blend-multiply ring-[1.5px]"
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
            />
          ))}
        </div>
        {/* PART B: per-page annotation overlay, keyed to the same viewport as the text layer. */}
        {vp && doc && (
          <Suspense fallback={null}>
            <PageAnnotateLayer page={pageNumber} vp={vp} />
          </Suspense>
        )}
        {failed && (
          <div className="bg-surface-container text-on-surface-variant absolute inset-0 grid place-items-center text-[12px]">
            Could not render this page.
          </div>
        )}
      </div>
      <span className="text-on-surface-variant absolute right-1 -bottom-5 text-[10px] tabular-nums select-none">
        {pageNumber}
      </span>
    </div>
  )
}
