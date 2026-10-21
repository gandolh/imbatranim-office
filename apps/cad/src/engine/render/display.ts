/**
 * Display lists: what to draw for an entity, in world coordinates, with its
 * colour and linetype already resolved. Built once per entity value (cached
 * by object identity, so an edit, which makes a new object, rebuilds only
 * that entity) and shared by the screen, the exports and the highlight pass.
 * An INSERT's list is its block's lists under the insert's transform.
 */
import {
  apply,
  applyLinear,
  determinant,
  isSimilarity,
  rotationOf,
  type Affine,
} from '../geom/affine'
import type { ArcSeg, LineSeg, Seg } from '../geom/seg'
import type { Vec } from '../geom/vec'
import type { CadDocument } from '../model/document'
import { ellipsePoints, insertTransform, mapSeg, polylineSegs } from '../model/geometry'
import { mtextLayout, textLayout, type TextLine } from '../model/text'
import type { Entity } from '../model/types'
import { resolveStyle, type Inherited, type ResolvedStyle } from './style'

export type StyleRef = ResolvedStyle & { key: string }

export type DisplayItem =
  | { t: 'seg'; seg: Seg; style: StyleRef }
  | { t: 'path'; segs: (LineSeg | ArcSeg)[]; closed: boolean; style: StyleRef }
  | { t: 'ellipse'; c: Vec; major: Vec; ratio: number; start: number; end: number; style: StyleRef }
  | { t: 'fill'; pts: Vec[]; style: StyleRef }
  | { t: 'poly'; pts: Vec[]; closed: boolean; style: StyleRef }
  | { t: 'text'; line: TextLine; style: StyleRef }
  | { t: 'point'; p: Vec; style: StyleRef }

const MAX_DEPTH = 8

function styleRef(s: ResolvedStyle): StyleRef {
  return { ...s, key: `${s.rgb}|${s.linetype?.name ?? ''}|${s.linetypeScale}` }
}

/** Items of one entity, before any insert transform. */
function ownItems(
  e: Entity,
  doc: CadDocument,
  fg: number,
  inherited: Inherited | undefined,
  depth: number
): DisplayItem[] {
  if (e.kind === 'insert') return insertItems(e, doc, fg, inherited, depth)
  const style = styleRef(resolveStyle(e, doc, fg, inherited))
  switch (e.kind) {
    case 'line':
      return [{ t: 'seg', seg: { kind: 'line', a: e.a, b: e.b }, style }]
    case 'circle':
      return [{ t: 'seg', seg: { kind: 'circle', c: e.c, r: e.r }, style }]
    case 'arc':
      return [{ t: 'seg', seg: { kind: 'arc', c: e.c, r: e.r, start: e.start, end: e.end }, style }]
    case 'polyline':
      return [{ t: 'path', segs: polylineSegs(e), closed: e.closed, style }]
    case 'ellipse':
      return [
        { t: 'ellipse', c: e.c, major: e.major, ratio: e.ratio, start: e.start, end: e.end, style },
      ]
    case 'point':
      return [{ t: 'point', p: e.p, style }]
    case 'text':
      return textLayout(e).map((line) => ({ t: 'text' as const, line, style }))
    case 'mtext':
      return mtextLayout(e).map((line) => ({ t: 'text' as const, line, style }))
    case 'foreign': {
      if (e.paperSpace) return []
      const out: DisplayItem[] = []
      const inh: Inherited = { layer: e.layer, color: e.color, rgb: e.rgb, linetype: e.linetype }
      for (const p of e.preview) {
        if (p.kind === 'block') {
          const block = doc.getBlock(p.block)
          if (!block || depth >= MAX_DEPTH) continue
          for (const child of block.entities) out.push(...ownItems(child, doc, fg, inh, depth + 1))
        } else if (p.fill) out.push({ t: 'fill', pts: p.pts, style })
        else out.push({ t: 'poly', pts: p.pts, closed: p.closed, style })
      }
      return out
    }
  }
}

function insertItems(
  e: Extract<Entity, { kind: 'insert' }>,
  doc: CadDocument,
  fg: number,
  inherited: Inherited | undefined,
  depth: number
): DisplayItem[] {
  const out: DisplayItem[] = []
  const block = doc.getBlock(e.block)
  if (block && depth < MAX_DEPTH) {
    const m = insertTransform(e, block)
    const layer = inherited && e.layer === '0' ? inherited.layer : e.layer
    const inh: Inherited = { layer, color: e.color, rgb: e.rgb, linetype: e.linetype }
    for (const child of block.entities) {
      for (const item of ownItems(child, doc, fg, inh, depth + 1)) out.push(...mapItem(item, m))
    }
  }
  for (const a of e.attribs) {
    if (a.hidden) continue
    out.push(...ownItems(a, doc, fg, inherited, depth + 1))
  }
  return out
}

function mapItem(item: DisplayItem, m: Affine): DisplayItem[] {
  switch (item.t) {
    case 'seg':
      return mapSeg(item.seg, m).map((seg) => ({ t: 'seg' as const, seg, style: item.style }))
    case 'path': {
      if (isSimilarity(m)) {
        return [
          {
            t: 'path',
            segs: item.segs.flatMap((s) => mapSeg(s, m) as (LineSeg | ArcSeg)[]),
            closed: false,
            style: item.style,
          },
        ]
      }
      return item.segs
        .flatMap((s) => mapSeg(s, m))
        .map((seg) => ({ t: 'seg' as const, seg, style: item.style }))
    }
    case 'ellipse': {
      if (isSimilarity(m)) {
        const flip = determinant(m) < 0
        return [
          {
            ...item,
            c: apply(m, item.c),
            major: applyLinear(m, item.major),
            start: flip ? -item.end : item.start,
            end: flip ? -item.start : item.end,
          },
        ]
      }
      const pts = ellipsePoints({
        kind: 'ellipse',
        c: item.c,
        major: item.major,
        ratio: item.ratio,
        start: item.start,
        end: item.end,
      } as Parameters<typeof ellipsePoints>[0])
      return [{ t: 'poly', pts: pts.map((p) => apply(m, p)), closed: false, style: item.style }]
    }
    case 'fill':
      return [{ ...item, pts: item.pts.map((p) => apply(m, p)) }]
    case 'poly':
      return [{ ...item, pts: item.pts.map((p) => apply(m, p)) }]
    case 'point':
      return [{ ...item, p: apply(m, item.p) }]
    case 'text': {
      // Text in a reflected block stays readable (no mirrored glyphs).
      const sx = Math.hypot(m.a, m.b)
      const sy = Math.hypot(m.c, m.d)
      return [
        {
          ...item,
          line: {
            ...item.line,
            at: apply(m, item.line.at),
            height: item.line.height * sy,
            widthFactor: item.line.widthFactor * (sy > 0 ? sx / sy : 1),
            rotation: item.line.rotation + rotationOf(m),
          },
        },
      ]
    }
  }
}

/** Display lists by entity value; dropped whole when layers or the background change. */
export class DisplayCache {
  private cache = new WeakMap<Entity, DisplayItem[]>()
  private readonly doc: CadDocument
  private fg = 0xffffff

  constructor(doc: CadDocument) {
    this.doc = doc
  }

  /** The colour ACI 7 is drawn in. */
  setForeground(rgb: number): void {
    if (rgb === this.fg) return
    this.fg = rgb
    this.invalidate()
  }

  get foreground(): number {
    return this.fg
  }

  invalidate(): void {
    this.cache = new WeakMap()
  }

  items(e: Entity): DisplayItem[] {
    let list = this.cache.get(e)
    if (!list) {
      list = ownItems(e, this.doc, this.fg, undefined, 0)
      this.cache.set(e, list)
    }
    return list
  }
}
