/**
 * Shapes on a slide, layout or master: finding them, their placeholder
 * identity, and their transform. Every function takes and returns elements of
 * the part's lossless tree; writing ones change only what they name.
 */
import { NS } from './ns.ts'
import { createElement, type XmlElement } from './xml.ts'

export type ShapeKind = 'sp' | 'pic' | 'grpSp' | 'cxnSp' | 'graphicFrame' | 'contentPart'

const SHAPE_KINDS = new Set<string>(['sp', 'pic', 'grpSp', 'cxnSp', 'graphicFrame', 'contentPart'])

const NV: Record<ShapeKind, string> = {
  sp: 'nvSpPr',
  pic: 'nvPicPr',
  grpSp: 'nvGrpSpPr',
  cxnSp: 'nvCxnSpPr',
  graphicFrame: 'nvGraphicFramePr',
  contentPart: 'nvContentPartPr',
}

/** The kind of a shape element, or null for anything else. */
export function shapeKind(el: XmlElement): ShapeKind | null {
  if ((el.ns === NS.p || el.ns === NS.dsp) && SHAPE_KINDS.has(el.local))
    return el.local as ShapeKind
  return null
}

/**
 * `mc:AlternateContent` wraps a shape a reader may not understand (a14 ink, a
 * p14 media frame). The editor treats the wrapper as the shape and reads the
 * branch it can draw: the Fallback, or the first Choice when there is none.
 */
export function alternateBranch(el: XmlElement): XmlElement | null {
  if (!el.is(NS.mc, 'AlternateContent')) return null
  const fallback = el.child(NS.mc, 'Fallback')
  const branch = fallback ?? el.child(NS.mc, 'Choice')
  return branch?.elements().find((c) => shapeKind(c) !== null) ?? null
}

/** The shape elements directly in a shape tree or group, wrappers included. */
export function childShapes(tree: XmlElement): XmlElement[] {
  return tree.elements().filter((c) => shapeKind(c) !== null || c.is(NS.mc, 'AlternateContent'))
}

/** The drawable shape of an element: itself, or the branch of its AlternateContent. */
export function drawable(el: XmlElement): XmlElement | null {
  return shapeKind(el) ? el : alternateBranch(el)
}

/** `p:cSld/p:spTree` of a slide, layout or master root. */
export function spTree(root: XmlElement): XmlElement | null {
  return root.path([NS.p, 'cSld'], [NS.p, 'spTree'])
}

/** `p:nvXxPr` of a shape. */
export function nonVisual(el: XmlElement): XmlElement | null {
  const kind = shapeKind(el)
  return kind ? el.child(el.ns as string, NV[kind]) : null
}

/** `p:cNvPr`, which carries the id and name. */
export function cNvPr(el: XmlElement): XmlElement | null {
  const nv = nonVisual(el)
  return nv ? nv.child(el.ns as string, 'cNvPr') : null
}

export function shapeId(el: XmlElement): string | null {
  const d = drawable(el)
  return d ? (cNvPr(d)?.attr('id') ?? null) : null
}

export function shapeName(el: XmlElement): string {
  const d = drawable(el)
  return d ? (cNvPr(d)?.attr('name') ?? '') : ''
}

/** Find a shape by id anywhere in a tree (groups included). Returns the outer element. */
export function findShape(tree: XmlElement, id: string): XmlElement | null {
  for (const el of childShapes(tree)) {
    if (shapeId(el) === id) return el
    const d = drawable(el)
    if (d && shapeKind(d) === 'grpSp') {
      const inner = findShape(d, id)
      if (inner) return inner
    }
  }
  return null
}

/** Every shape id used in a tree, groups included. */
export function usedIds(tree: XmlElement, out = new Set<number>()): Set<number> {
  const own = tree.path([NS.p, 'nvGrpSpPr'], [NS.p, 'cNvPr'])?.attr('id')
  if (own) out.add(Number(own))
  for (const el of childShapes(tree)) {
    const id = Number(shapeId(el))
    if (Number.isFinite(id)) out.add(id)
    const d = drawable(el)
    if (d && shapeKind(d) === 'grpSp') usedIds(d, out)
  }
  return out
}

/** The next free shape id in a slide. */
export function nextShapeId(tree: XmlElement): number {
  let max = 1
  for (const id of usedIds(tree)) if (id > max) max = id
  return max + 1
}

export type Placeholder = {
  /** `p:ph/@type`, defaulting to the schema's `obj`. */
  type: string
  /** `p:ph/@idx`, null when absent. */
  idx: string | null
}

/** The placeholder a shape stands for, or null when it is not one. */
export function placeholderOf(el: XmlElement): Placeholder | null {
  const d = drawable(el)
  if (!d) return null
  const nv = nonVisual(d)
  const ph = nv?.child(d.ns as string, 'nvPr')?.child(NS.p, 'ph')
  if (!ph) return null
  return { type: ph.attr('type') ?? 'obj', idx: ph.attr('idx') }
}

/** Placeholder types that share one master placeholder. */
export function masterPlaceholderType(type: string): string {
  if (type === 'ctrTitle') return 'title'
  if (type === 'title' || type === 'dt' || type === 'ftr' || type === 'sldNum') return type
  return 'body'
}

function sameTitleFamily(a: string, b: string): boolean {
  const t = (x: string) => (x === 'ctrTitle' ? 'title' : x)
  return t(a) === t(b)
}

/**
 * The placeholder on a layout that a slide's placeholder inherits from: the
 * one with the same idx, else the first of the same type.
 */
export function matchLayoutPlaceholder(layoutTree: XmlElement, ph: Placeholder): XmlElement | null {
  const shapes = childShapes(layoutTree)
  if (ph.idx !== null) {
    const byIdx = shapes.find((s) => placeholderOf(s)?.idx === ph.idx)
    if (byIdx) return byIdx
  }
  return (
    shapes.find((s) => {
      const other = placeholderOf(s)
      return other !== null && sameTitleFamily(other.type, ph.type)
    }) ?? null
  )
}

/** The placeholder on a master that a layout's placeholder of `type` inherits from. */
export function matchMasterPlaceholder(masterTree: XmlElement, type: string): XmlElement | null {
  const want = masterPlaceholderType(type)
  return (
    childShapes(masterTree).find((s) => {
      const other = placeholderOf(s)
      return other !== null && masterPlaceholderType(other.type) === want
    }) ?? null
  )
}

// ── Transforms ───────────────────────────────────────────────────────────────

export type Xfrm = {
  x: number
  y: number
  cx: number
  cy: number
  /** Degrees, clockwise. */
  rot: number
  flipH: boolean
  flipV: boolean
}

/** A group's child coordinate space. */
export type ChildSpace = { chX: number; chY: number; chCx: number; chCy: number }

/** `a:xfrm` (or `p:xfrm` on a graphic frame) of a shape, null when it has none. */
export function xfrmElement(el: XmlElement): XmlElement | null {
  const d = drawable(el)
  if (!d) return null
  const kind = shapeKind(d)
  if (kind === 'graphicFrame') return d.child(d.ns as string, 'xfrm')
  const props = d.child(d.ns as string, kind === 'grpSp' ? 'grpSpPr' : 'spPr')
  return props?.child(NS.a, 'xfrm') ?? null
}

const num = (v: string | null, fallback = 0) => {
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function readXfrm(xfrm: XmlElement): Xfrm & Partial<ChildSpace> {
  const off = xfrm.child(NS.a, 'off')
  const ext = xfrm.child(NS.a, 'ext')
  const chOff = xfrm.child(NS.a, 'chOff')
  const chExt = xfrm.child(NS.a, 'chExt')
  const out: Xfrm & Partial<ChildSpace> = {
    x: num(off?.attr('x') ?? null),
    y: num(off?.attr('y') ?? null),
    cx: num(ext?.attr('cx') ?? null),
    cy: num(ext?.attr('cy') ?? null),
    rot: num(xfrm.attr('rot')) / 60000,
    flipH: xfrm.attr('flipH') === '1' || xfrm.attr('flipH') === 'true',
    flipV: xfrm.attr('flipV') === '1' || xfrm.attr('flipV') === 'true',
  }
  if (chOff && chExt) {
    out.chX = num(chOff.attr('x'))
    out.chY = num(chOff.attr('y'))
    out.chCx = num(chExt.attr('cx'))
    out.chCy = num(chExt.attr('cy'))
  }
  return out
}

/** A shape's own transform, null when it inherits one (a placeholder). */
export function ownXfrm(el: XmlElement): (Xfrm & Partial<ChildSpace>) | null {
  const x = xfrmElement(el)
  if (!x || !x.child(NS.a, 'off') || !x.child(NS.a, 'ext')) return null
  return readXfrm(x)
}

/**
 * Write a shape's transform, creating `a:xfrm` as the first child of its
 * properties (its place in the schema) when the shape inherited one. Only the
 * attributes that change are written.
 */
export function writeXfrm(el: XmlElement, next: Xfrm): void {
  const d = drawable(el)
  if (!d) throw new Error('not a shape')
  const kind = shapeKind(d) as ShapeKind
  let xfrm = xfrmElement(d)
  if (!xfrm) {
    if (kind === 'graphicFrame') {
      // p:graphicFrame: nvGraphicFramePr, xfrm, graphic.
      xfrm = createElement(d, d.ns as string, 'xfrm', 'p')
      const nv = nonVisual(d)
      if (nv) d.insertAfter(xfrm, nv)
      else d.insert(xfrm, 0)
    } else {
      const propsName = kind === 'grpSp' ? 'grpSpPr' : 'spPr'
      let props = d.child(d.ns as string, propsName)
      if (!props) {
        props = createElement(d, d.ns as string, propsName, 'p')
        const nv = nonVisual(d)
        if (nv) d.insertAfter(props, nv)
        else d.insert(props, 0)
      }
      xfrm = createElement(props, NS.a, 'xfrm', 'a')
      props.insert(xfrm, 0)
    }
  }
  const round = (n: number) => String(Math.round(n))
  const rot = Math.round((((next.rot % 360) + 360) % 360) * 60000)
  if (rot === 0) xfrm.removeAttr('rot')
  else xfrm.setAttr('rot', String(rot))
  if (next.flipH) xfrm.setAttr('flipH', '1')
  else xfrm.removeAttr('flipH')
  if (next.flipV) xfrm.setAttr('flipV', '1')
  else xfrm.removeAttr('flipV')
  let off = xfrm.child(NS.a, 'off')
  if (!off) {
    off = createElement(xfrm, NS.a, 'off', 'a')
    xfrm.insert(off, 0)
  }
  off.setAttr('x', round(next.x))
  off.setAttr('y', round(next.y))
  let ext = xfrm.child(NS.a, 'ext')
  if (!ext) {
    ext = createElement(xfrm, NS.a, 'ext', 'a')
    xfrm.insertAfter(ext, off)
  }
  ext.setAttr('cx', round(Math.max(0, next.cx)))
  ext.setAttr('cy', round(Math.max(0, next.cy)))
}

/**
 * Move a group by writing its new frame. Its child space (chOff/chExt) stays,
 * so its children follow, scaled when the size changes, without touching them.
 * A group that had no child space gets one equal to its old frame first.
 */
export function writeGroupXfrm(el: XmlElement, next: Xfrm): void {
  const d = drawable(el)
  if (!d) return
  const x = xfrmElement(d)
  if (x && (!x.child(NS.a, 'chOff') || !x.child(NS.a, 'chExt'))) {
    const old = readXfrm(x)
    const chOff = createElement(x, NS.a, 'chOff', 'a', { x: String(old.x), y: String(old.y) })
    const chExt = createElement(x, NS.a, 'chExt', 'a', { cx: String(old.cx), cy: String(old.cy) })
    x.append(chOff)
    x.append(chExt)
  }
  writeXfrm(d, next)
}
