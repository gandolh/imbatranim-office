/**
 * The per-page annotation overlay — mounted inside each rendered page (PageView)
 * above the canvas + text layer. Two jobs:
 *
 *  1. **Display** — draw every session-added annotation on this page (from
 *     `doc.annotate.list(page)` filtered to the editor's `addedIds`) as an SVG
 *     overlay, so a mark appears instantly without re-rasterising. Marks already
 *     baked into the page (existing on open, or committed by a save→reload) are
 *     drawn by the raster itself and skipped here — except sticky notes, which
 *     have no appearance stream for the raster to draw, so they are always
 *     drawn here.
 *
 *  2. **Creation** — when a drawing tool is active, capture pointer input on the
 *     page, show a live preview, and commit via `addAnnotation` (or, for Sign,
 *     `doc.sign.place` + a raster sync). Screen↔PDF conversion goes through the
 *     engine's one shared transform (`toViewTransform` + the coords helpers).
 *
 * Presentation is the OS design language: runtime-styled SVG marks read the
 * `--accent`-derived `--norpdf-accent-strong`, set on the overlay as a Tailwind
 * arbitrary property; DOM affordances (delete button, text entry popover) use
 * OS Tailwind token utilities. (norPDF kept these in norpdf.css; the suite's
 * build takes Tailwind utilities only, brief 06.)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  pdfRectToScreenBox,
  pdfToScreenPoint,
  screenBoxToPdfRect,
  screenToPdfPoint,
  toViewTransform,
} from '@pdfcore/engine/browser'
import type { Annotation, PageViewport, Point } from '@pdfcore/engine'
import { useReader } from '../app/context'
import { useEditor } from './context'
import { cssColor } from './util'

interface Pt {
  x: number
  y: number
}

/** In-progress gesture, in screen px relative to the overlay. */
type Draft =
  | { kind: 'box'; start: Pt; cur: Pt }
  | { kind: 'seg'; start: Pt; cur: Pt }
  | { kind: 'ink'; points: Pt[] }
  | null

/** A placed but not-yet-typed free-text / note awaiting its text. */
interface TextEntry {
  kind: 'freeText' | 'note'
  at: Pt // top-left of the entry box (screen px)
  box?: { w: number; h: number }
}

const MIN_DRAG = 4 // px — below this a "box" gesture is treated as a click

export interface PageAnnotateLayerProps {
  page: number
  vp: PageViewport
}

export function PageAnnotateLayer({ page, vp }: PageAnnotateLayerProps): JSX.Element | null {
  const { doc } = useReader()
  const editor = useEditor()
  const {
    tool,
    color,
    opacity,
    strokeWidth,
    addAnnotation,
    addedIds,
    selectedId,
    setSelectedId,
    deleteAnnotation,
    signMark,
    setSignMark,
    setTool,
    syncRaster,
  } = editor

  const t = useMemo(() => toViewTransform(vp), [vp])
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Draft>(null)
  const [entry, setEntry] = useState<TextEntry | null>(null)
  const [entryText, setEntryText] = useState('')

  const drawing = tool !== 'select'
  const w = vp.width
  const h = vp.height

  // The session marks on this page (baked marks are drawn by the raster), and
  // every sticky note: a Text annotation has no appearance of its own (the
  // viewer draws its icon), so the raster never shows one. Drawing them here
  // makes a saved note visible after a reopen, and a note another app left
  // visible at all (brief 06; norPDF showed neither).
  const marks: Annotation[] = doc
    ? doc.annotate.list(page).filter((a) => addedIds.has(a.id) || a.type === 'note')
    : []

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  /* ── Pointer gestures ─────────────────────────────────────────────────── */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawing || !doc) return
    // A text entry is open — let its own controls handle input.
    if (entry) return
    e.preventDefault()
    capturePointer(e.target, e.pointerId, true)
    const p = local(e)
    switch (tool) {
      case 'ink':
        setDraft({ kind: 'ink', points: [p] })
        break
      case 'line':
      case 'arrow':
        setDraft({ kind: 'seg', start: p, cur: p })
        break
      default:
        // highlight / underline / strikeout / rect / freeText / note / sign
        setDraft({ kind: 'box', start: p, cur: p })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draft) return
    const p = local(e)
    setDraft((d) => {
      if (!d) return d
      if (d.kind === 'ink') return { kind: 'ink', points: [...d.points, p] }
      return { ...d, cur: p }
    })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!draft || !doc) return
    capturePointer(e.target, e.pointerId, false)
    const d = draft
    setDraft(null)

    if (d.kind === 'ink') {
      if (d.points.length < 2) return
      const path = d.points.map((p) => screenToPdfPoint(p, t))
      addAnnotation({
        type: 'ink',
        page,
        paths: [path],
        width: strokeWidth,
        color,
        opacity,
      })
      return
    }

    if (d.kind === 'seg') {
      const start = screenToPdfPoint(d.start, t)
      const end = screenToPdfPoint(d.cur, t)
      addAnnotation({
        type: tool === 'arrow' ? 'arrow' : 'line',
        page,
        start,
        end,
        width: strokeWidth,
        color,
        opacity,
      })
      return
    }

    // Box gesture.
    const box = normBox(d.start, d.cur)
    const isClick = box.w < MIN_DRAG && box.h < MIN_DRAG

    if (tool === 'note') {
      setEntryText('')
      setEntry({ kind: 'note', at: d.cur })
      return
    }
    if (tool === 'freeText') {
      const b = isClick ? { ...box, w: 180, h: 44 } : box
      setEntryText('')
      setEntry({ kind: 'freeText', at: { x: b.x, y: b.y }, box: { w: b.w, h: b.h } })
      return
    }
    if (isClick) return // ignore stray clicks for the box tools

    const rect = screenBoxToPdfRect(box, t)
    if (tool === 'sign') {
      if (!signMark) return
      doc.sign.place({ page, rect, mark: signMark })
      // A placed signature is committed as a real annotation with no id we can
      // track for the overlay, so bake it into the raster and return to select.
      setSignMark(null)
      setTool('select')
      void syncRaster()
      return
    }
    if (tool === 'rect') {
      addAnnotation({ type: 'rect', page, rect, width: strokeWidth, color, opacity })
      return
    }
    // highlight / underline / strikeout
    addAnnotation({
      type: tool as 'highlight' | 'underline' | 'strikeout',
      page,
      rect,
      color,
      opacity,
    })
  }

  /* ── Free-text / note commit ──────────────────────────────────────────── */
  const commitEntry = () => {
    if (!entry || !doc) {
      setEntry(null)
      return
    }
    const text = entryText.trim()
    if (!text) {
      setEntry(null)
      return
    }
    if (entry.kind === 'note') {
      const at = screenToPdfPoint(entry.at, t)
      addAnnotation({ type: 'note', page, at, text, color })
    } else {
      const b = entry.box ?? { w: 180, h: 44 }
      const rect = screenBoxToPdfRect({ x: entry.at.x, y: entry.at.y, w: b.w, h: b.h }, t)
      addAnnotation({ type: 'freeText', page, rect, text, fontSize: 12, color })
    }
    setEntry(null)
    setEntryText('')
  }

  // Focus the entry textarea when it opens.
  const entryRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (entry) entryRef.current?.focus()
  }, [entry])

  const active = drawing || marks.length > 0 || !!entry
  if (!active && !selectedId) {
    // Nothing to draw and no capture needed — render nothing so text selection
    // underneath keeps working.
    return null
  }

  return (
    <div
      className="absolute inset-0 z-[4] [--norpdf-accent-strong:color-mix(in_srgb,var(--accent)_72%,#000)]"
      style={{ width: w, height: h, cursor: drawing ? 'crosshair' : undefined }}
    >
      <svg
        ref={svgRef}
        className="absolute inset-0 overflow-visible"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ pointerEvents: drawing && !entry ? 'auto' : 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {marks.map((a) => (
          <AnnotationMark
            key={a.id}
            ann={a}
            t={t}
            selected={a.id === selectedId}
            selectable={tool === 'select'}
            onSelect={() => setSelectedId(a.id)}
          />
        ))}
        {draft && (
          <DraftPreview draft={draft} tool={tool} color={color} strokeWidth={strokeWidth} />
        )}
      </svg>

      {/* Delete affordance for the selected mark. */}
      {selectedId &&
        (() => {
          const sel = marks.find((m) => m.id === selectedId)
          if (!sel) return null
          const anchor = markAnchor(sel, t)
          return (
            <button
              type="button"
              className="bg-error text-on-error absolute z-[6] grid h-5 w-5 -translate-x-[40%] -translate-y-[60%] place-items-center border-none text-[14px] leading-none shadow-md hover:brightness-110"
              style={{ left: anchor.x, top: anchor.y }}
              title="Delete annotation"
              onClick={() => void deleteAnnotation(selectedId)}
            >
              ×
            </button>
          )
        })()}

      {/* Free-text / sticky-note text entry. */}
      {entry && (
        <div
          className="border-outline-variant bg-surface-container-lowest absolute z-[7] flex min-w-[160px] flex-col gap-1 border p-2 shadow-[0_10px_28px_rgba(0,0,0,0.4)]"
          style={{
            left: entry.at.x,
            top: entry.at.y,
            width: entry.box?.w ?? 190,
            pointerEvents: 'auto',
          }}
        >
          <textarea
            ref={entryRef}
            className="border-outline-variant bg-surface-container-lowest text-on-surface font-ui focus:border-primary min-h-[46px] resize-y border px-1.5 py-1 text-[12px] outline-none"
            value={entryText}
            placeholder={entry.kind === 'note' ? 'Note…' : 'Text…'}
            onChange={(ev) => setEntryText(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
                ev.preventDefault()
                commitEntry()
              }
              if (ev.key === 'Escape') {
                ev.preventDefault()
                setEntry(null)
              }
            }}
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface font-ui px-2 py-0.5 text-[11px]"
              onClick={() => setEntry(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="bg-primary text-on-primary font-ui px-2 py-0.5 text-[11px] font-semibold hover:brightness-110"
              onClick={commitEntry}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Rendering one committed annotation ─────────────────────────────────── */

function AnnotationMark({
  ann,
  t,
  selected,
  selectable,
  onSelect,
}: {
  ann: Annotation
  t: ReturnType<typeof toViewTransform>
  selected: boolean
  selectable: boolean
  onSelect: () => void
}): JSX.Element | null {
  const stroke = ann.color ? cssColor(ann.color) : 'var(--accent)'
  const alpha = ann.opacity ?? 1
  const pe = selectable ? 'auto' : 'none'
  const selStyle = selected
    ? { outline: 'none', filter: 'drop-shadow(0 0 0 1px var(--norpdf-accent-strong))' }
    : undefined

  const wrap = (inner: JSX.Element): JSX.Element => (
    <g
      style={{ cursor: selectable ? 'pointer' : 'default', pointerEvents: pe, ...selStyle }}
      onPointerDown={(e) => {
        if (selectable) {
          e.stopPropagation()
          onSelect()
        }
      }}
    >
      {selected && <SelectionHalo ann={ann} t={t} />}
      {inner}
    </g>
  )

  switch (ann.type) {
    case 'highlight': {
      const rects = [ann.rect, ...(ann.rects ?? [])]
      return wrap(
        <g style={{ mixBlendMode: 'multiply' }}>
          {rects.map((r, i) => {
            const b = pdfRectToScreenBox(r, t)
            return (
              <rect
                key={i}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                fill={cssColor(ann.color ?? { r: 0.95, g: 0.72, b: 0.2 }, Math.min(alpha, 0.45))}
                rx={1}
              />
            )
          })}
        </g>
      )
    }
    case 'underline':
    case 'strikeout': {
      const rects = [ann.rect, ...(ann.rects ?? [])]
      return wrap(
        <g>
          {rects.map((r, i) => {
            const b = pdfRectToScreenBox(r, t)
            const y = ann.type === 'underline' ? b.y + b.h - 1.5 : b.y + b.h / 2
            return (
              <line
                key={i}
                x1={b.x}
                y1={y}
                x2={b.x + b.w}
                y2={y}
                stroke={stroke}
                strokeWidth={1.8}
                strokeOpacity={alpha}
              />
            )
          })}
        </g>
      )
    }
    case 'rect': {
      const b = pdfRectToScreenBox(ann.rect, t)
      return wrap(
        <rect
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill={ann.fill ? cssColor(ann.fill, alpha) : 'none'}
          stroke={stroke}
          strokeWidth={(ann.width ?? 1) * t.scale}
          strokeOpacity={alpha}
        />
      )
    }
    case 'line':
    case 'arrow': {
      const s = pdfToScreenPoint(ann.start, t)
      const e = pdfToScreenPoint(ann.end, t)
      return wrap(
        <g stroke={stroke} strokeWidth={(ann.width ?? 1) * t.scale} strokeOpacity={alpha}>
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} />
          {ann.type === 'arrow' && arrowHead(s, e, stroke)}
        </g>
      )
    }
    case 'ink': {
      return wrap(
        <g
          fill="none"
          stroke={stroke}
          strokeWidth={(ann.width ?? 1) * t.scale}
          strokeOpacity={alpha}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ann.paths.map((path, i) => (
            <polyline
              key={i}
              points={path.map((p) => pointStr(pdfToScreenPoint(p, t))).join(' ')}
            />
          ))}
        </g>
      )
    }
    case 'freeText': {
      const b = pdfRectToScreenBox(ann.rect, t)
      const size = (ann.fontSize ?? 12) * t.scale
      return wrap(
        <foreignObject x={b.x} y={b.y} width={Math.max(b.w, 12)} height={Math.max(b.h, 12)}>
          <div
            className="font-ui box-border h-full w-full overflow-hidden rounded-[2px] border border-dashed border-current px-[3px] py-[2px] leading-[1.25] [word-break:break-word] whitespace-pre-wrap"
            style={{ color: stroke, fontSize: size, borderColor: stroke }}
          >
            {ann.text}
          </div>
        </foreignObject>
      )
    }
    case 'note': {
      const p = pdfToScreenPoint(ann.at, t)
      return wrap(
        <g transform={`translate(${p.x - 8} ${p.y - 8})`}>
          <title>{ann.text}</title>
          <rect x={0} y={0} width={18} height={18} rx={2} fill={stroke} fillOpacity={0.9} />
          <path d="M4 5.5h10M4 9h10M4 12.5h6" stroke="#fff" strokeWidth={1.2} fill="none" />
        </g>
      )
    }
    default:
      return null
  }
}

/** A faint bounding halo around the selected mark. */
function SelectionHalo({
  ann,
  t,
}: {
  ann: Annotation
  t: ReturnType<typeof toViewTransform>
}): JSX.Element | null {
  const b = boundsOf(ann, t)
  if (!b) return null
  return (
    <rect
      x={b.x - 4}
      y={b.y - 4}
      width={b.w + 8}
      height={b.h + 8}
      fill="none"
      stroke="var(--norpdf-accent-strong)"
      strokeWidth={1.5}
      strokeDasharray="4 3"
      rx={3}
    />
  )
}

/* ── Live drag preview ──────────────────────────────────────────────────── */

function DraftPreview({
  draft,
  tool,
  color,
  strokeWidth,
}: {
  draft: NonNullable<Draft>
  tool: string
  color: { r: number; g: number; b: number }
  strokeWidth: number
}): JSX.Element {
  const stroke = cssColor(color)
  if (draft.kind === 'ink') {
    return (
      <polyline
        points={draft.points.map(pointStr).join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }
  if (draft.kind === 'seg') {
    return (
      <g stroke={stroke} strokeWidth={strokeWidth}>
        <line x1={draft.start.x} y1={draft.start.y} x2={draft.cur.x} y2={draft.cur.y} />
        {tool === 'arrow' && arrowHead(draft.start, draft.cur, stroke)}
      </g>
    )
  }
  const b = normBox(draft.start, draft.cur)
  if (tool === 'highlight') {
    return (
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        fill={cssColor(color, 0.4)}
        style={{ mixBlendMode: 'multiply' }}
        rx={1}
      />
    )
  }
  if (tool === 'underline' || tool === 'strikeout') {
    const y = tool === 'underline' ? b.y + b.h : b.y + b.h / 2
    return <line x1={b.x} y1={y} x2={b.x + b.w} y2={y} stroke={stroke} strokeWidth={1.8} />
  }
  // rect / freeText / note / sign box
  return (
    <rect
      x={b.x}
      y={b.y}
      width={b.w}
      height={b.h}
      fill="none"
      stroke={stroke}
      strokeWidth={1.5}
      strokeDasharray={tool === 'sign' || tool === 'freeText' ? '5 3' : undefined}
      rx={2}
    />
  )
}

/* ── geometry helpers ───────────────────────────────────────────────────── */

/** Best-effort pointer capture — never let a missing/synthetic pointer throw. */
function capturePointer(target: EventTarget | null, id: number, on: boolean): void {
  const el = target as Element | null
  try {
    if (on) el?.setPointerCapture?.(id)
    else el?.releasePointerCapture?.(id)
  } catch {
    /* no active pointer (e.g. synthetic events) — ignore */
  }
}

function normBox(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

function pointStr(p: Pt): string {
  return `${p.x},${p.y}`
}

function arrowHead(from: Pt, to: Pt, stroke: string): JSX.Element {
  const ang = Math.atan2(to.y - from.y, to.x - from.x)
  const len = 11
  const spread = 0.45
  const p1 = { x: to.x - len * Math.cos(ang - spread), y: to.y - len * Math.sin(ang - spread) }
  const p2 = { x: to.x - len * Math.cos(ang + spread), y: to.y - len * Math.sin(ang + spread) }
  return (
    <polyline
      points={`${p1.x},${p1.y} ${to.x},${to.y} ${p2.x},${p2.y}`}
      fill="none"
      stroke={stroke}
    />
  )
}

/** Screen-space bounds of an annotation (for the selection halo). */
function boundsOf(
  ann: Annotation,
  t: ReturnType<typeof toViewTransform>
): { x: number; y: number; w: number; h: number } | null {
  const pts: Pt[] = []
  const push = (p: Point) => pts.push(pdfToScreenPoint(p, t))
  switch (ann.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'rect':
    case 'freeText': {
      const b = pdfRectToScreenBox(ann.rect, t)
      return b
    }
    case 'line':
    case 'arrow':
      push(ann.start)
      push(ann.end)
      break
    case 'ink':
      for (const path of ann.paths) for (const p of path) push(p)
      break
    case 'note': {
      const p = pdfToScreenPoint(ann.at, t)
      return { x: p.x - 9, y: p.y - 9, w: 18, h: 18 }
    }
    default:
      return null
  }
  if (!pts.length) return null
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Where to anchor the delete button for a selected mark (screen px). */
function markAnchor(ann: Annotation, t: ReturnType<typeof toViewTransform>): Pt {
  const b = boundsOf(ann, t)
  if (!b) return { x: 0, y: 0 }
  return { x: b.x + b.w, y: b.y }
}
