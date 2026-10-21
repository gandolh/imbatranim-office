/**
 * The Canvas 2D renderer. Per frame: ask the R-tree for what is on screen,
 * bucket the display items by style (colour + linetype), and stroke each
 * bucket as one path, so 10,000 lines cost a handful of `stroke()` calls.
 * Fills go first, text last. World → screen happens here, in doubles.
 */
import { arcEnd, arcStart, type ArcSeg, type LineSeg, type Seg } from '../geom/seg'
import type { Vec } from '../geom/vec'
import type { CadDocument } from '../model/document'
import { CHAR_WIDTH } from '../model/text'
import type { View } from '../view'
import type { DisplayCache, DisplayItem, StyleRef } from './display'
import type { SpatialIndex } from './spatial'
import { dashFor, hex } from './style'

export type RenderStats = {
  visible: number
  items: number
  ms: number
  /** Milliseconds per phase: culling and bucketing, fills, strokes, text. */
  phases: { collect: number; fills: number; strokes: number; text: number }
}

export const TEXT_FONT = 'Arial, Helvetica, sans-serif'
/** Segments per stroke() call. */
const STROKE_CHUNK = 1024

type Bucket = { style: StyleRef; items: DisplayItem[] }

/** Stroke one item into the current path. */
export function traceItem(ctx: CanvasRenderingContext2D, view: View, item: DisplayItem): void {
  const s = view.scale
  const ox = view.width / 2 - view.cx * s
  const oy = view.height / 2 + view.cy * s
  const X = (x: number) => x * s + ox
  const Y = (y: number) => oy - y * s
  switch (item.t) {
    case 'seg':
      traceSeg(ctx, item.seg, X, Y, s, null)
      return
    case 'path': {
      let pen: Vec | null = null
      for (const seg of item.segs) pen = traceSeg(ctx, seg, X, Y, s, pen)
      if (item.closed) ctx.closePath()
      return
    }
    case 'poly':
    case 'fill': {
      const pts = item.pts
      if (pts.length === 0) return
      let px = X(pts[0].x)
      let py = Y(pts[0].y)
      ctx.moveTo(px, py)
      for (let i = 1; i < pts.length; i++) {
        const x = X(pts[i].x)
        const y = Y(pts[i].y)
        if (Math.abs(x - px) < 0.5 && Math.abs(y - py) < 0.5 && i < pts.length - 1) continue
        ctx.lineTo(x, y)
        px = x
        py = y
      }
      if (item.t === 'fill' || item.closed) ctx.closePath()
      return
    }
    case 'ellipse': {
      const rx = Math.hypot(item.major.x, item.major.y)
      const rot = Math.atan2(item.major.y, item.major.x)
      const cx = X(item.c.x)
      const cy = Y(item.c.y)
      const full = Math.abs(item.end - item.start) >= Math.PI * 2 - 1e-9 || item.end === item.start
      const sx =
        cx +
        Math.cos(-rot) * rx * s * Math.cos(-item.start) -
        Math.sin(-rot) * rx * item.ratio * s * Math.sin(-item.start)
      const sy =
        cy +
        Math.sin(-rot) * rx * s * Math.cos(-item.start) +
        Math.cos(-rot) * rx * item.ratio * s * Math.sin(-item.start)
      ctx.moveTo(sx, sy)
      if (full)
        ctx.ellipse(
          cx,
          cy,
          rx * s,
          rx * item.ratio * s,
          -rot,
          -item.start,
          -item.start - Math.PI * 2,
          true
        )
      else ctx.ellipse(cx, cy, rx * s, rx * item.ratio * s, -rot, -item.start, -item.end, true)
      return
    }
    case 'point': {
      const x = X(item.p.x)
      const y = Y(item.p.y)
      ctx.moveTo(x - 0.5, y)
      ctx.lineTo(x + 0.5, y)
      return
    }
    case 'text':
      return
  }
}

function traceSeg(
  ctx: CanvasRenderingContext2D,
  seg: Seg | LineSeg | ArcSeg,
  X: (x: number) => number,
  Y: (y: number) => number,
  s: number,
  pen: Vec | null
): Vec | null {
  if (seg.kind === 'line') {
    const ax = X(seg.a.x)
    const ay = Y(seg.a.y)
    const bx = X(seg.b.x)
    const by = Y(seg.b.y)
    if (pen && Math.abs(pen.x - ax) < 0.01 && Math.abs(pen.y - ay) < 0.01) {
      // A vertex under half a pixel from the last one adds nothing on screen.
      if (Math.abs(bx - pen.x) < 0.5 && Math.abs(by - pen.y) < 0.5) return pen
      ctx.lineTo(bx, by)
      return { x: bx, y: by }
    }
    if (pen && Math.abs(pen.x - bx) < 0.01 && Math.abs(pen.y - by) < 0.01) {
      ctx.lineTo(ax, ay)
      return { x: ax, y: ay }
    }
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    return { x: bx, y: by }
  }
  const cx = X(seg.c.x)
  const cy = Y(seg.c.y)
  const r = seg.r * s
  if (seg.kind === 'circle') {
    ctx.moveTo(cx + r, cy)
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    return null
  }
  const ps = arcStart(seg)
  const pe = arcEnd(seg)
  const sStart = { x: X(ps.x), y: Y(ps.y) }
  const sEnd = { x: X(pe.x), y: Y(pe.y) }
  const reversed =
    pen !== null &&
    Math.hypot(pen.x - sEnd.x, pen.y - sEnd.y) < Math.hypot(pen.x - sStart.x, pen.y - sStart.y)
  if (reversed) {
    if (!pen || Math.hypot(pen.x - sEnd.x, pen.y - sEnd.y) > 0.01) ctx.moveTo(sEnd.x, sEnd.y)
    ctx.arc(cx, cy, r, -seg.end, -seg.start, false)
    return sStart
  }
  if (!pen || Math.hypot(pen.x - sStart.x, pen.y - sStart.y) > 0.01) ctx.moveTo(sStart.x, sStart.y)
  ctx.arc(cx, cy, r, -seg.start, -seg.end, true)
  return sEnd
}

/** Glyphs are drawn from one font size and scaled, so `ctx.font` is set once per pass. */
const REF_PX = 100
/** Below this height (px) text is drawn as one stroke along its line: glyphs that small cannot be read. */
export const GREEK_PX = 4

type TextItem = Extract<DisplayItem, { t: 'text' }>

/** Draw text items of one colour: glyphs where readable, a greeked stroke where not. */
export function drawTexts(
  ctx: CanvasRenderingContext2D,
  view: View,
  items: readonly TextItem[],
  color: string,
  dpr: number
): void {
  const greek: TextItem[] = []
  let fontSet = false
  let align = ''
  let baseline = ''
  for (const item of items) {
    const line = item.line
    const px = line.height * view.scale
    if (px < 1 || line.text === '') continue
    if (px < GREEK_PX) {
      greek.push(item)
      continue
    }
    if (!fontSet) {
      ctx.font = `${REF_PX}px ${TEXT_FONT}`
      ctx.fillStyle = color
      fontSet = true
    }
    if (line.align !== align) ctx.textAlign = align = line.align
    if (line.baseline !== baseline)
      ctx.textBaseline = baseline = line.baseline as CanvasTextBaseline
    const at = view.toScreen(line.at)
    const k = px / REF_PX
    const cs = Math.cos(-line.rotation)
    const sn = Math.sin(-line.rotation)
    const wk = k * line.widthFactor
    ctx.setTransform(
      dpr * cs * wk,
      dpr * sn * wk,
      -dpr * sn * k,
      dpr * cs * k,
      dpr * at.x,
      dpr * at.y
    )
    ctx.fillText(line.text, 0, 0)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (greek.length === 0) return
  ctx.strokeStyle = color
  ctx.beginPath()
  for (const item of greek) {
    const line = item.line
    const w = line.text.length * line.height * CHAR_WIDTH * line.widthFactor
    const x0 = line.align === 'left' ? 0 : line.align === 'center' ? -w / 2 : -w
    const y =
      line.baseline === 'alphabetic' || line.baseline === 'bottom'
        ? line.height * 0.35
        : line.baseline === 'middle'
          ? 0
          : -line.height * 0.5
    const cs = Math.cos(line.rotation)
    const sn = Math.sin(line.rotation)
    const a = view.toScreen({ x: line.at.x + x0 * cs - y * sn, y: line.at.y + x0 * sn + y * cs })
    const b = view.toScreen({
      x: line.at.x + (x0 + w) * cs - y * sn,
      y: line.at.y + (x0 + w) * sn + y * cs,
    })
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
  }
  ctx.stroke()
}

export class Renderer {
  private readonly doc: CadDocument
  private readonly index: SpatialIndex
  readonly cache: DisplayCache

  constructor(doc: CadDocument, index: SpatialIndex, cache: DisplayCache) {
    this.doc = doc
    this.index = index
    this.cache = cache
  }

  /** Visible entity handles (layer on and thawed), culled to the view. */
  visibleHandles(view: View): string[] {
    const handles = this.index.search(view.worldBox(2))
    const out: string[] = []
    for (const h of handles) {
      const e = this.doc.entities.get(h)
      if (!e) continue
      const l = this.doc.layer(e.layer)
      if (!l.on || l.frozen) continue
      out.push(h)
    }
    return out
  }

  render(
    ctx: CanvasRenderingContext2D,
    view: View,
    opts: { background: string; dpr: number; skip?: ReadonlySet<string> }
  ): RenderStats {
    const t0 = performance.now()
    ctx.setTransform(opts.dpr, 0, 0, opts.dpr, 0, 0)
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, view.width, view.height)
    const handles = this.visibleHandles(view)
    const strokes = new Map<string, Bucket>()
    const fills = new Map<string, Bucket>()
    const texts = new Map<number, TextItem[]>()
    let count = 0
    for (const h of handles) {
      if (opts.skip?.has(h)) continue
      const e = this.doc.entities.get(h)
      if (!e) continue
      for (const item of this.cache.items(e)) {
        count++
        if (item.t === 'text') {
          let list = texts.get(item.style.rgb)
          if (!list) texts.set(item.style.rgb, (list = []))
          list.push(item)
          continue
        }
        const map = item.t === 'fill' ? fills : strokes
        let b = map.get(item.style.key)
        if (!b) {
          b = { style: item.style, items: [] }
          map.set(item.style.key, b)
        }
        b.items.push(item)
      }
    }
    const t1 = performance.now()
    ctx.lineWidth = 1
    ctx.lineJoin = 'miter'
    ctx.lineCap = 'butt'
    for (const b of fills.values()) {
      ctx.fillStyle = hex(b.style.rgb)
      ctx.beginPath()
      for (const item of b.items) traceItem(ctx, view, item)
      ctx.fill('evenodd')
    }
    const t2 = performance.now()
    for (const b of strokes.values()) {
      ctx.strokeStyle = hex(b.style.rgb)
      ctx.setLineDash(dashFor(b.style.linetype, b.style.linetypeScale, view.scale) ?? [])
      // Chrome strokes one huge, dense path far slower than several small ones.
      let n = 0
      ctx.beginPath()
      for (const item of b.items) {
        traceItem(ctx, view, item)
        n += item.t === 'path' ? item.segs.length : item.t === 'poly' ? item.pts.length : 1
        if (n >= STROKE_CHUNK) {
          ctx.stroke()
          ctx.beginPath()
          n = 0
        }
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
    const t3 = performance.now()
    for (const [rgb, list] of texts) drawTexts(ctx, view, list, hex(rgb), opts.dpr)
    const t4 = performance.now()
    return {
      visible: handles.length,
      items: count,
      ms: t4 - t0,
      phases: { collect: t1 - t0, fills: t2 - t1, strokes: t3 - t2, text: t4 - t3 },
    }
  }
}
