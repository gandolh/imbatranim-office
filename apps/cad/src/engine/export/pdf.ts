/**
 * PDF export with pdf-lib: the drawing fitted on an A3 sheet (landscape or
 * portrait by its shape) with a 10 mm margin, on white paper. Lines are PDF
 * paths, arcs cubic Béziers (PDF has no arc), text Helvetica.
 */
import {
  PDFDocument,
  StandardFonts,
  closePath,
  degrees,
  fill,
  lineTo,
  moveTo,
  appendBezierCurve,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setDashPattern,
  setFillingRgbColor,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFFont,
  type PDFOperator,
} from 'pdf-lib'
import { arcEnd, arcStart, sweepOf, type ArcSeg, type LineSeg, type Seg } from '../geom/seg'
import type { Vec } from '../geom/vec'
import type { CadDocument } from '../model/document'
import { ellipsePoints } from '../model/geometry'
import type { EllipseEntity } from '../model/types'
import { DisplayCache, type DisplayItem } from '../render/display'
import { drawingExtents, visibleEntities } from './svg'

const MM = 72 / 25.4
const A3 = { long: 420 * MM, short: 297 * MM }
const MARGIN = 10 * MM

type Map2 = (p: Vec) => Vec

/** Cubic Bézier control points for an arc from angle a0 sweeping s (|s| ≤ 90°). */
function arcBeziers(c: Vec, r: number, a0: number, sweep: number): [Vec, Vec, Vec][] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)))
  const step = sweep / n
  const k = (4 / 3) * Math.tan(step / 4)
  const out: [Vec, Vec, Vec][] = []
  for (let i = 0; i < n; i++) {
    const t0 = a0 + step * i
    const t1 = t0 + step
    const p0 = { x: c.x + r * Math.cos(t0), y: c.y + r * Math.sin(t0) }
    const p3 = { x: c.x + r * Math.cos(t1), y: c.y + r * Math.sin(t1) }
    out.push([
      { x: p0.x - k * r * Math.sin(t0), y: p0.y + k * r * Math.cos(t0) },
      { x: p3.x + k * r * Math.sin(t1), y: p3.y - k * r * Math.cos(t1) },
      p3,
    ])
  }
  return out
}

function emitArc(ops: PDFOperator[], s: ArcSeg, reversed: boolean, M: Map2, move: boolean): Vec {
  const sweep = sweepOf(s.start, s.end)
  const a0 = reversed ? s.start + sweep : s.start
  const sw = reversed ? -sweep : sweep
  const start = M({ x: s.c.x + s.r * Math.cos(a0), y: s.c.y + s.r * Math.sin(a0) })
  if (move) ops.push(moveTo(start.x, start.y))
  let last = start
  for (const [c1, c2, p] of arcBeziers(s.c, s.r, a0, sw)) {
    const q1 = M(c1)
    const q2 = M(c2)
    last = M(p)
    ops.push(appendBezierCurve(q1.x, q1.y, q2.x, q2.y, last.x, last.y))
  }
  return last
}

function emitSeg(ops: PDFOperator[], seg: Seg, M: Map2): void {
  if (seg.kind === 'line') {
    const a = M(seg.a)
    const b = M(seg.b)
    ops.push(moveTo(a.x, a.y), lineTo(b.x, b.y))
    return
  }
  if (seg.kind === 'circle') {
    emitArc(ops, { kind: 'arc', c: seg.c, r: seg.r, start: 0, end: 0 }, false, M, true)
    ops.push(closePath())
    return
  }
  emitArc(ops, seg, false, M, true)
}

function emitRun(
  ops: PDFOperator[],
  segs: readonly (LineSeg | ArcSeg)[],
  closed: boolean,
  M: Map2
): void {
  let pen: Vec | null = null
  const eq = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6
  for (const s of segs) {
    if (s.kind === 'line') {
      const a = M(s.a)
      const b = M(s.b)
      if (pen && eq(pen, a)) ops.push(lineTo(b.x, b.y))
      else if (pen && eq(pen, b)) {
        ops.push(lineTo(a.x, a.y))
        pen = a
        continue
      } else ops.push(moveTo(a.x, a.y), lineTo(b.x, b.y))
      pen = b
      continue
    }
    const a = M(arcStart(s))
    const b = M(arcEnd(s))
    const reversed =
      pen !== null && Math.hypot(pen.x - b.x, pen.y - b.y) < Math.hypot(pen.x - a.x, pen.y - a.y)
    pen = emitArc(ops, s, reversed, M, !pen || !eq(pen, reversed ? b : a))
  }
  if (closed) ops.push(closePath())
}

function emitPoly(ops: PDFOperator[], pts: readonly Vec[], closed: boolean, M: Map2): void {
  if (pts.length === 0) return
  const p0 = M(pts[0])
  ops.push(moveTo(p0.x, p0.y))
  for (let i = 1; i < pts.length; i++) {
    const p = M(pts[i])
    ops.push(lineTo(p.x, p.y))
  }
  if (closed) ops.push(closePath())
}

const toRgb = (c: number) => rgb(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255)

/** Characters Helvetica (WinAnsi) can show; others become '?'. */
function printable(font: PDFFont, text: string): string {
  const set = new Set(font.getCharacterSet())
  return [...text.replace('⌀', 'Ø')]
    .map((ch) => (set.has(ch.codePointAt(0) ?? 0) ? ch : '?'))
    .join('')
}

/** The drawing as a one-page PDF. */
export async function exportPdf(doc: CadDocument, title = 'Drawing'): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setCreator('imbatranim-office CAD')
  pdf.setProducer('pdf-lib')
  const ext = drawingExtents(doc) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  const w = Math.max(ext.maxX - ext.minX, 1e-6)
  const h = Math.max(ext.maxY - ext.minY, 1e-6)
  const landscape = w >= h
  const pageW = landscape ? A3.long : A3.short
  const pageH = landscape ? A3.short : A3.long
  const page = pdf.addPage([pageW, pageH])
  const s = Math.min((pageW - 2 * MARGIN) / w, (pageH - 2 * MARGIN) / h)
  const ox = (pageW - w * s) / 2
  const oy = (pageH - h * s) / 2
  const M: Map2 = (p) => ({ x: ox + (p.x - ext.minX) * s, y: oy + (p.y - ext.minY) * s })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const cache = new DisplayCache(doc)
  cache.setForeground(0x000000)

  const ops: PDFOperator[] = [pushGraphicsState(), setLineWidth(0.35)]
  const texts: Extract<DisplayItem, { t: 'text' }>[] = []
  let current = ''
  for (const e of visibleEntities(doc)) {
    for (const item of cache.items(e)) {
      if (item.t === 'text') {
        texts.push(item)
        continue
      }
      const key = `${item.style.key}|${item.t === 'fill' ? 'f' : 's'}`
      if (key !== current) {
        current = key
        const c = toRgb(item.style.rgb)
        ops.push(
          setStrokingRgbColor(c.red, c.green, c.blue),
          setFillingRgbColor(c.red, c.green, c.blue)
        )
        const lt = item.style.linetype
        ops.push(
          setDashPattern(
            lt
              ? lt.pattern.map((d) => Math.max(Math.abs(d) * item.style.linetypeScale * s, 0.5))
              : [],
            0
          )
        )
      }
      switch (item.t) {
        case 'seg':
          emitSeg(ops, item.seg, M)
          ops.push(stroke())
          break
        case 'path':
          emitRun(ops, item.segs, item.closed, M)
          ops.push(stroke())
          break
        case 'poly':
          emitPoly(ops, item.pts, item.closed, M)
          ops.push(stroke())
          break
        case 'fill':
          emitPoly(ops, item.pts, true, M)
          ops.push(fill())
          break
        case 'ellipse':
          emitPoly(
            ops,
            ellipsePoints({
              kind: 'ellipse',
              c: item.c,
              major: item.major,
              ratio: item.ratio,
              start: item.start,
              end: item.end,
            } as EllipseEntity),
            false,
            M
          )
          ops.push(stroke())
          break
        case 'point': {
          const p = M(item.p)
          ops.push(moveTo(p.x - 0.3, p.y), lineTo(p.x + 0.3, p.y), stroke())
          break
        }
      }
    }
  }
  ops.push(popGraphicsState())
  page.pushOperators(...ops)

  for (const t of texts) {
    const l = t.line
    const size = l.height * s
    if (size < 0.5 || l.text === '') continue
    const text = printable(font, l.text)
    const width = font.widthOfTextAtSize(text, size) * l.widthFactor
    const dx = l.align === 'left' ? 0 : l.align === 'center' ? -width / 2 : -width
    const dy =
      l.baseline === 'alphabetic' || l.baseline === 'bottom'
        ? 0
        : l.baseline === 'middle'
          ? -size * 0.35
          : -size * 0.75
    const at = M(l.at)
    const cs = Math.cos(l.rotation)
    const sn = Math.sin(l.rotation)
    page.drawText(text, {
      x: at.x + dx * cs - dy * sn,
      y: at.y + dx * sn + dy * cs,
      size,
      font,
      color: toRgb(t.style.rgb),
      rotate: degrees((l.rotation * 180) / Math.PI),
    })
  }
  return pdf.save()
}
