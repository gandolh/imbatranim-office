/**
 * SVG export, from the model: the same display lists the screen draws, on
 * white paper (ACI 7 is black), one group per layer, true arcs, text as
 * text. Coordinates stay in drawing units under one Y-flip.
 */
import { arcEnd, arcStart, sweepOf, type ArcSeg, type LineSeg, type Seg } from '../geom/seg'
import type { Vec } from '../geom/vec'
import type { CadDocument } from '../model/document'
import {
  entityBounds,
  isEmptyBounds,
  unionBounds,
  EMPTY_BOUNDS,
  ellipsePoints,
  type Bounds,
} from '../model/geometry'
import type { EllipseEntity, Entity } from '../model/types'
import { DisplayCache, type DisplayItem } from '../render/display'
import { hex } from '../render/style'
import { TEXT_FONT } from '../render/renderer'

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? '0' : String(r)
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Bounds of everything visible in model space. */
export function drawingExtents(doc: CadDocument): Bounds | null {
  let b = EMPTY_BOUNDS
  for (const e of visibleEntities(doc)) b = unionBounds(b, entityBounds(e, doc.getBlock))
  return isEmptyBounds(b) ? null : b
}

export function visibleEntities(doc: CadDocument): Entity[] {
  return doc.all().filter((e) => {
    const l = doc.layer(e.layer)
    return l.on && !l.frozen && !(e.kind === 'foreign' && e.paperSpace)
  })
}

function arcPath(s: ArcSeg, move: boolean): string {
  const a = arcStart(s)
  const b = arcEnd(s)
  const sweep = sweepOf(s.start, s.end)
  if (sweep >= Math.PI * 2 - 1e-9) {
    const m = { x: 2 * s.c.x - a.x, y: 2 * s.c.y - a.y }
    return `${move ? `M${fmt(a.x)} ${fmt(a.y)}` : ''}A${fmt(s.r)} ${fmt(s.r)} 0 0 1 ${fmt(m.x)} ${fmt(m.y)}A${fmt(s.r)} ${fmt(s.r)} 0 0 1 ${fmt(a.x)} ${fmt(a.y)}`
  }
  // Counter-clockwise in drawing units is the positive sweep inside the Y-flipped group.
  return `${move ? `M${fmt(a.x)} ${fmt(a.y)}` : ''}A${fmt(s.r)} ${fmt(s.r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${fmt(b.x)} ${fmt(b.y)}`
}

function segPath(seg: Seg): string {
  if (seg.kind === 'line') return `M${fmt(seg.a.x)} ${fmt(seg.a.y)}L${fmt(seg.b.x)} ${fmt(seg.b.y)}`
  if (seg.kind === 'circle')
    return arcPath({ kind: 'arc', c: seg.c, r: seg.r, start: 0, end: 0 }, true)
  return arcPath(seg, true)
}

/** A run of segments in travel order (arcs may run either way round). */
function runPath(segs: readonly (LineSeg | ArcSeg)[], closed: boolean): string {
  let d = ''
  let pen = null as Vec | null
  for (const s of segs) {
    if (s.kind === 'line') {
      const near: boolean = pen !== null && Math.hypot(pen.x - s.a.x, pen.y - s.a.y) < 1e-9
      const back: boolean = pen !== null && !near && Math.hypot(pen.x - s.b.x, pen.y - s.b.y) < 1e-9
      const from: Vec = back ? s.b : s.a
      const to: Vec = back ? s.a : s.b
      if (!near && !back) d += `M${fmt(from.x)} ${fmt(from.y)}`
      d += `L${fmt(to.x)} ${fmt(to.y)}`
      pen = to
      continue
    }
    const a = arcStart(s)
    const b = arcEnd(s)
    const reversed: boolean =
      pen !== null && Math.hypot(pen.x - b.x, pen.y - b.y) < Math.hypot(pen.x - a.x, pen.y - a.y)
    const sweep = sweepOf(s.start, s.end)
    const from: Vec = reversed ? b : a
    const to: Vec = reversed ? a : b
    if (!pen || Math.hypot(pen.x - from.x, pen.y - from.y) > 1e-9)
      d += `M${fmt(from.x)} ${fmt(from.y)}`
    d += `A${fmt(s.r)} ${fmt(s.r)} 0 ${sweep > Math.PI ? 1 : 0} ${reversed ? 0 : 1} ${fmt(to.x)} ${fmt(to.y)}`
    pen = to
  }
  return closed ? `${d}Z` : d
}

function polyPath(pts: readonly Vec[], closed: boolean): string {
  if (pts.length === 0) return ''
  return `M${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join('L')}${closed ? 'Z' : ''}`
}

const BASELINE: Record<string, string> = {
  alphabetic: 'alphabetic',
  bottom: 'text-after-edge',
  middle: 'central',
  top: 'hanging',
}
const ANCHOR: Record<string, string> = { left: 'start', center: 'middle', right: 'end' }

function itemSvg(item: DisplayItem, strokeWidth: number): string {
  const color = hex(item.style.rgb)
  const dash = item.style.linetype
    ? ` stroke-dasharray="${item.style.linetype.pattern.map((d) => fmt(Math.max(Math.abs(d) * item.style.linetypeScale, strokeWidth))).join(' ')}"`
    : ''
  const stroke = `fill="none" stroke="${color}"${dash}`
  switch (item.t) {
    case 'seg':
      return `<path d="${segPath(item.seg)}" ${stroke}/>`
    case 'path':
      return `<path d="${runPath(item.segs, item.closed)}" ${stroke}/>`
    case 'poly':
      return `<path d="${polyPath(item.pts, item.closed)}" ${stroke}/>`
    case 'fill':
      return `<path d="${polyPath(item.pts, true)}" fill="${color}" fill-rule="evenodd" stroke="none"/>`
    case 'ellipse': {
      const pts = ellipsePoints({
        kind: 'ellipse',
        c: item.c,
        major: item.major,
        ratio: item.ratio,
        start: item.start,
        end: item.end,
      } as EllipseEntity)
      return `<path d="${polyPath(pts, false)}" ${stroke}/>`
    }
    case 'point':
      return `<circle cx="${fmt(item.p.x)}" cy="${fmt(item.p.y)}" r="${fmt(strokeWidth)}" fill="${color}"/>`
    case 'text': {
      const l = item.line
      if (l.text === '') return ''
      const deg = (l.rotation * 180) / Math.PI
      const wf = l.widthFactor !== 1 ? ` scale(${fmt(l.widthFactor)} 1)` : ''
      return `<text transform="translate(${fmt(l.at.x)} ${fmt(l.at.y)}) scale(1 -1) rotate(${fmt(-deg)})${wf}" font-size="${fmt(l.height)}" text-anchor="${ANCHOR[l.align]}" dominant-baseline="${BASELINE[l.baseline]}" fill="${color}" stroke="none">${esc(l.text)}</text>`
    }
  }
}

/** The drawing as an SVG document (UTF-8 bytes). */
export function exportSvg(doc: CadDocument): Uint8Array {
  const ext = drawingExtents(doc) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  const w = Math.max(ext.maxX - ext.minX, 1e-6)
  const h = Math.max(ext.maxY - ext.minY, 1e-6)
  const margin = Math.max(w, h) * 0.03
  const strokeWidth = Math.max(w, h) / 1500
  const cache = new DisplayCache(doc)
  cache.setForeground(0x000000)
  const byLayer = new Map<string, string[]>()
  for (const e of visibleEntities(doc)) {
    const parts = cache.items(e).map((i) => itemSvg(i, strokeWidth))
    const list = byLayer.get(e.layer) ?? []
    list.push(...parts)
    byLayer.set(e.layer, list)
  }
  const vbX = ext.minX - margin
  const vbY = -(ext.maxY + margin)
  const vbW = w + 2 * margin
  const vbH = h + 2 * margin
  // A size to view it at: the longest side 1200 px. The geometry stays in drawing units (the viewBox).
  const k = 1200 / Math.max(vbW, vbH)
  const pxW = vbW * k
  const pxH = vbH * k
  const groups = [...byLayer.entries()]
    .map(
      ([layer, parts]) =>
        `<g data-layer="${esc(layer)}">\n${parts.filter(Boolean).join('\n')}\n</g>`
    )
    .join('\n')
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" width="${fmt(pxW)}" height="${fmt(pxH)}">`,
    `<rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="#ffffff"/>`,
    `<g transform="scale(1 -1)" stroke-width="${fmt(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" font-family="${esc(TEXT_FONT)}">`,
    groups,
    '</g>',
    '</svg>',
    '',
  ].join('\n')
  return new TextEncoder().encode(svg)
}
