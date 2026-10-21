/**
 * What each entity kind is, geometrically: the segments snaps and edits work
 * on, its bounds, how a similarity map moves it, and its grips.
 */
import {
  IDENTITY,
  apply,
  applyLinear,
  compose,
  determinant,
  isSimilarity,
  rotation,
  rotationOf,
  scaleOf,
  scaling,
  translation,
  type Affine,
} from '../geom/affine'
import {
  arcEnd,
  arcMid,
  arcStart,
  arcThrough,
  bulgeSeg,
  segBounds,
  sweepOf,
  type ArcSeg,
  type LineSeg,
  type Seg,
} from '../geom/seg'
import { TAU, angleOf, dist, mid, normAngle, polar, sub, type Vec } from '../geom/vec'
import { lineBox, mtextLayout, textLayout } from './text'
import type { Block, EllipseEntity, Entity, PolylineEntity } from './types'

export type BlockLookup = (name: string) => Block | undefined

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export const EMPTY_BOUNDS: Bounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export const isEmptyBounds = (b: Bounds): boolean => !(b.minX <= b.maxX && b.minY <= b.maxY)

export function pointsBounds(pts: readonly Vec[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** The segments of a polyline, one per vertex (closing segment included when closed). */
export function polylineSegs(e: Pick<PolylineEntity, 'vertices' | 'closed'>): (LineSeg | ArcSeg)[] {
  const v = e.vertices
  const out: (LineSeg | ArcSeg)[] = []
  const n = e.closed ? v.length : v.length - 1
  for (let i = 0; i < n; i++) {
    const p = v[i]
    const q = v[(i + 1) % v.length]
    if (p.x === q.x && p.y === q.y) continue
    out.push(bulgeSeg(p, q, p.bulge))
  }
  return out
}

export function ellipsePoint(e: Pick<EllipseEntity, 'c' | 'major' | 'ratio'>, t: number): Vec {
  const minor = { x: -e.major.y * e.ratio, y: e.major.x * e.ratio }
  const cs = Math.cos(t)
  const sn = Math.sin(t)
  return { x: e.c.x + e.major.x * cs + minor.x * sn, y: e.c.y + e.major.y * cs + minor.y * sn }
}

/** An ellipse as a polyline of `n` chords per full turn (snaps and hit tests only). */
export function ellipsePoints(e: EllipseEntity, perTurn = 96): Vec[] {
  const sweep = sweepOf(e.start, e.end)
  const n = Math.max(8, Math.ceil((perTurn * sweep) / TAU))
  const pts: Vec[] = []
  for (let i = 0; i <= n; i++) pts.push(ellipsePoint(e, e.start + (sweep * i) / n))
  return pts
}

/** Block coordinates → world, for an INSERT. */
export function insertTransform(
  e: { position: Vec; sx: number; sy: number; rotation: number },
  block: Block | undefined
): Affine {
  const base = block?.base ?? { x: 0, y: 0 }
  const scale: Affine = { a: e.sx, b: 0, c: 0, d: e.sy, e: 0, f: 0 }
  return compose(
    translation(e.position.x, e.position.y),
    compose(rotation(e.rotation), compose(scale, translation(-base.x, -base.y)))
  )
}

/** A segment under an affine map; circles and arcs only stay exact under similarity maps. */
export function mapSeg(s: Seg, m: Affine): Seg[] {
  if (s.kind === 'line') return [{ kind: 'line', a: apply(m, s.a), b: apply(m, s.b) }]
  if (isSimilarity(m)) {
    const c = apply(m, s.c)
    const r = s.r * scaleOf(m)
    if (s.kind === 'circle') return [{ kind: 'circle', c, r }]
    const rot = rotationOf(m)
    if (determinant(m) < 0) {
      // A reflection runs the arc the other way round.
      const ps = apply(m, arcStart(s))
      const pe = apply(m, arcEnd(s))
      return [
        {
          kind: 'arc',
          c,
          r,
          start: normAngle(angleOf(sub(pe, c))),
          end: normAngle(angleOf(sub(ps, c))),
        },
      ]
    }
    return [{ kind: 'arc', c, r, start: normAngle(s.start + rot), end: normAngle(s.end + rot) }]
  }
  const sweep = s.kind === 'circle' ? TAU : sweepOf(s.start, s.end)
  const start = s.kind === 'circle' ? 0 : s.start
  const n = Math.max(8, Math.ceil((64 * sweep) / TAU))
  const out: Seg[] = []
  let prev = apply(m, polar(s.c, s.r, start))
  for (let i = 1; i <= n; i++) {
    const next = apply(m, polar(s.c, s.r, start + (sweep * i) / n))
    out.push({ kind: 'line', a: prev, b: next })
    prev = next
  }
  return out
}

const MAX_BLOCK_DEPTH = 8

/**
 * The exact segments of an entity in world coordinates. Text has none; an
 * INSERT contributes its block's segments, transformed.
 */
export function entitySegs(e: Entity, blocks: BlockLookup, depth = 0): Seg[] {
  switch (e.kind) {
    case 'line':
      return [{ kind: 'line', a: e.a, b: e.b }]
    case 'circle':
      return [{ kind: 'circle', c: e.c, r: e.r }]
    case 'arc':
      return [{ kind: 'arc', c: e.c, r: e.r, start: e.start, end: e.end }]
    case 'polyline':
      return polylineSegs(e)
    case 'ellipse': {
      const pts = ellipsePoints(e)
      const out: Seg[] = []
      for (let i = 1; i < pts.length; i++) out.push({ kind: 'line', a: pts[i - 1], b: pts[i] })
      return out
    }
    case 'insert': {
      if (depth >= MAX_BLOCK_DEPTH) return []
      const block = blocks(e.block)
      if (!block) return []
      const m = insertTransform(e, block)
      return block.entities.flatMap((child) =>
        entitySegs(child, blocks, depth + 1).flatMap((s) => mapSeg(s, m))
      )
    }
    case 'foreign': {
      const out: Seg[] = []
      for (const p of e.preview) {
        if (p.kind === 'block') {
          if (depth >= MAX_BLOCK_DEPTH) continue
          const block = blocks(p.block)
          if (block)
            for (const child of block.entities) out.push(...entitySegs(child, blocks, depth + 1))
          continue
        }
        for (let i = 1; i < p.pts.length; i++)
          out.push({ kind: 'line', a: p.pts[i - 1], b: p.pts[i] })
        if (p.closed && p.pts.length > 2)
          out.push({ kind: 'line', a: p.pts[p.pts.length - 1], b: p.pts[0] })
      }
      return out
    }
    default:
      return []
  }
}

/** World-space outline points of text, for bounds and hit tests. */
export function textCorners(e: Entity): Vec[] | null {
  if (e.kind === 'text') return textLayout(e).flatMap(lineBox)
  if (e.kind === 'mtext') return mtextLayout(e).flatMap(lineBox)
  return null
}

export function entityBounds(e: Entity, blocks: BlockLookup, depth = 0): Bounds {
  switch (e.kind) {
    case 'text':
    case 'mtext':
      return pointsBounds(textCorners(e) ?? [])
    case 'point':
      return { minX: e.p.x, minY: e.p.y, maxX: e.p.x, maxY: e.p.y }
    case 'insert': {
      if (depth >= MAX_BLOCK_DEPTH)
        return { minX: e.position.x, minY: e.position.y, maxX: e.position.x, maxY: e.position.y }
      const block = blocks(e.block)
      let b: Bounds = {
        minX: e.position.x,
        minY: e.position.y,
        maxX: e.position.x,
        maxY: e.position.y,
      }
      if (block) {
        const m = insertTransform(e, block)
        for (const child of block.entities) {
          const cb = entityBounds(child, blocks, depth + 1)
          if (isEmptyBounds(cb)) continue
          b = unionBounds(
            b,
            pointsBounds(
              [
                { x: cb.minX, y: cb.minY },
                { x: cb.maxX, y: cb.minY },
                { x: cb.maxX, y: cb.maxY },
                { x: cb.minX, y: cb.maxY },
              ].map((p) => apply(m, p))
            )
          )
        }
      }
      for (const a of e.attribs) b = unionBounds(b, entityBounds(a, blocks, depth + 1))
      return b
    }
    case 'foreign': {
      let b = EMPTY_BOUNDS
      for (const p of e.preview) {
        if (p.kind === 'block') {
          const block = blocks(p.block)
          if (block && depth < MAX_BLOCK_DEPTH)
            for (const child of block.entities)
              b = unionBounds(b, entityBounds(child, blocks, depth + 1))
        } else b = unionBounds(b, pointsBounds(p.pts))
      }
      return b
    }
    default: {
      let b = EMPTY_BOUNDS
      for (const s of entitySegs(e, blocks, depth)) b = unionBounds(b, segBounds(s))
      return b
    }
  }
}

// ── Transforms ───────────────────────────────────────────────────────────────

/** Can MOVE, COPY, ROTATE, SCALE and MIRROR change this entity? */
export const isTransformable = (e: Entity): boolean => e.kind !== 'foreign'

/**
 * An entity under a similarity map (translation, rotation, uniform scale,
 * reflection). Returns null for an entity that cannot be transformed.
 * Text keeps reading left to right under a reflection (AutoCAD's MIRRTEXT 0):
 * its insertion point is reflected, its direction is not.
 */
export function transformEntity<E extends Entity>(e: E, m: Affine): E | null {
  const s = scaleOf(m)
  const rot = rotationOf(m)
  const flip = determinant(m) < 0
  switch (e.kind) {
    case 'line':
      return { ...e, a: apply(m, e.a), b: apply(m, e.b) }
    case 'point':
      return { ...e, p: apply(m, e.p) }
    case 'circle':
      return { ...e, c: apply(m, e.c), r: e.r * s }
    case 'arc': {
      const [seg] = mapSeg(
        { kind: 'arc', c: e.c, r: e.r, start: e.start, end: e.end },
        m
      ) as ArcSeg[]
      return { ...e, c: seg.c, r: seg.r, start: seg.start, end: seg.end }
    }
    case 'polyline':
      return {
        ...e,
        vertices: e.vertices.map((v) => {
          const p = apply(m, v)
          return { x: p.x, y: p.y, bulge: flip ? -v.bulge : v.bulge }
        }),
        width: e.width * s,
      }
    case 'ellipse': {
      const major = applyLinear(m, e.major)
      return flip
        ? { ...e, c: apply(m, e.c), major, start: normAngle(-e.end), end: normAngle(-e.start) }
        : { ...e, c: apply(m, e.c), major }
    }
    case 'text': {
      const textRot = flip ? e.rotation : e.rotation + rot
      return {
        ...e,
        position: apply(m, e.position),
        alignPoint: e.alignPoint ? apply(m, e.alignPoint) : undefined,
        height: e.height * s,
        rotation: normAngle(textRot),
      }
    }
    case 'mtext':
      return {
        ...e,
        position: apply(m, e.position),
        height: e.height * s,
        width: e.width * s,
        rotation: normAngle(flip ? e.rotation : e.rotation + rot),
      }
    case 'insert': {
      const attribs = e.attribs.map((a) => transformEntity(a, m) ?? a)
      if (flip) {
        // Reflection = rotation of a reflected (sx negated) block.
        return {
          ...e,
          position: apply(m, e.position),
          sx: -e.sx * s,
          sy: e.sy * s,
          rotation: normAngle(rot - e.rotation + Math.PI),
          attribs,
        }
      }
      return {
        ...e,
        position: apply(m, e.position),
        sx: e.sx * s,
        sy: e.sy * s,
        rotation: normAngle(e.rotation + rot),
        attribs,
      }
    }
    default:
      return null
  }
}

export { IDENTITY, scaling, rotation, translation }

// ── Grips ────────────────────────────────────────────────────────────────────

export type Grip = { point: Vec; /** What dragging it does. */ role: 'stretch' | 'move' | 'radius' }

export function entityGrips(e: Entity): Grip[] {
  switch (e.kind) {
    case 'line':
      return [
        { point: e.a, role: 'stretch' },
        { point: mid(e.a, e.b), role: 'move' },
        { point: e.b, role: 'stretch' },
      ]
    case 'circle':
      return [
        { point: e.c, role: 'move' },
        ...[0, 1, 2, 3].map((q) => ({
          point: polar(e.c, e.r, (q * Math.PI) / 2),
          role: 'radius' as const,
        })),
      ]
    case 'arc': {
      const seg: ArcSeg = { kind: 'arc', c: e.c, r: e.r, start: e.start, end: e.end }
      return [
        { point: arcStart(seg), role: 'stretch' },
        { point: arcMid(seg), role: 'stretch' },
        { point: arcEnd(seg), role: 'stretch' },
        { point: e.c, role: 'move' },
      ]
    }
    case 'polyline':
      return e.vertices.map((v) => ({ point: { x: v.x, y: v.y }, role: 'stretch' as const }))
    case 'ellipse':
      return [{ point: e.c, role: 'move' }]
    case 'point':
      return [{ point: e.p, role: 'move' }]
    case 'text':
    case 'mtext':
    case 'insert':
      return [{ point: e.position, role: 'move' }]
    default:
      return []
  }
}

/** The entity after grip `index` is dragged from its spot to `to`. */
export function applyGrip<E extends Entity>(e: E, index: number, to: Vec): E | null {
  const grip = entityGrips(e)[index]
  if (!grip) return null
  if (grip.role === 'move')
    return transformEntity(e, translation(to.x - grip.point.x, to.y - grip.point.y))
  switch (e.kind) {
    case 'line':
      return index === 0 ? { ...e, a: to } : { ...e, b: to }
    case 'circle': {
      const r = dist(e.c, to)
      return r > 0 ? { ...e, r } : null
    }
    case 'arc': {
      const seg: ArcSeg = { kind: 'arc', c: e.c, r: e.r, start: e.start, end: e.end }
      const pts = [arcStart(seg), arcMid(seg), arcEnd(seg)]
      pts[index] = to
      const arc = arcThrough(pts[0], pts[1], pts[2])
      return arc ? { ...e, c: arc.c, r: arc.r, start: arc.start, end: arc.end } : null
    }
    case 'polyline':
      return {
        ...e,
        vertices: e.vertices.map((v, i) => (i === index ? { ...v, x: to.x, y: to.y } : v)),
      }
    default:
      return null
  }
}
