/**
 * Directed segments: a polyline's pieces in the order and direction it is
 * travelled, with a parameter t ∈ [0, 1] along each. Arcs keep their signed
 * sweep (positive counter-clockwise), which is what a DXF bulge encodes, so
 * cutting a piece out of an arc gives its new bulge directly.
 */
import { bulgeSeg, type ArcSeg, type LineSeg, type Seg } from './seg'
import { EPS, TAU, angleOf, dist, normAngle, polar, sub, type Vec } from './vec'
import type { PolyVertex } from '../model/types'

export type DLine = { kind: 'line'; a: Vec; b: Vec }
/** From angle a0, turning `sweep` radians (positive CCW, negative CW). */
export type DArc = { kind: 'arc'; c: Vec; r: number; a0: number; sweep: number }
export type DSeg = DLine | DArc

export function dsegFromBulge(p: Vec, q: Vec, bulge: number): DSeg {
  if (Math.abs(bulge) < 1e-12) return { kind: 'line', a: p, b: q }
  const arc = bulgeSeg(p, q, bulge) as ArcSeg
  const sweep = 4 * Math.atan(bulge)
  return { kind: 'arc', c: arc.c, r: arc.r, a0: normAngle(angleOf(sub(p, arc.c))), sweep }
}

export function dStart(s: DSeg): Vec {
  return s.kind === 'line' ? s.a : polar(s.c, s.r, s.a0)
}
export function dEnd(s: DSeg): Vec {
  return s.kind === 'line' ? s.b : polar(s.c, s.r, s.a0 + s.sweep)
}

export function dPoint(s: DSeg, t: number): Vec {
  if (s.kind === 'line') return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }
  return polar(s.c, s.r, s.a0 + s.sweep * t)
}

/** Unit tangent in the direction of travel at t. */
export function dTangent(s: DSeg, t: number): Vec {
  if (s.kind === 'line') {
    const d = dist(s.a, s.b)
    return d < EPS ? { x: 1, y: 0 } : { x: (s.b.x - s.a.x) / d, y: (s.b.y - s.a.y) / d }
  }
  const a = s.a0 + s.sweep * t
  const k = s.sweep >= 0 ? 1 : -1
  return { x: -Math.sin(a) * k, y: Math.cos(a) * k }
}

/** The parameter of a point on the segment's line or circle (lines unbounded; arcs in [0, 1] when on the arc, else outside). */
export function dParam(s: DSeg, p: Vec): number {
  if (s.kind === 'line') {
    const dx = s.b.x - s.a.x
    const dy = s.b.y - s.a.y
    const l2 = dx * dx + dy * dy
    return l2 < EPS * EPS ? 0 : ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2
  }
  const phi = angleOf(sub(p, s.c))
  const rel = s.sweep >= 0 ? normAngle(phi - s.a0) : normAngle(s.a0 - phi)
  const sw = Math.abs(s.sweep)
  // Points just before the start come back slightly negative rather than near 2π.
  return rel > sw + (TAU - sw) / 2 ? (rel - TAU) / sw : rel / sw
}

/** The undirected segment (for intersections and closest points). */
export function dToSeg(s: DSeg): LineSeg | ArcSeg {
  if (s.kind === 'line') return { kind: 'line', a: s.a, b: s.b }
  return s.sweep >= 0
    ? { kind: 'arc', c: s.c, r: s.r, start: normAngle(s.a0), end: normAngle(s.a0 + s.sweep) }
    : { kind: 'arc', c: s.c, r: s.r, start: normAngle(s.a0 + s.sweep), end: normAngle(s.a0) }
}

/** The full line or circle of a segment (for extended intersections). */
export function dCarrier(s: DSeg): Seg {
  return s.kind === 'line' ? { kind: 'line', a: s.a, b: s.b } : { kind: 'circle', c: s.c, r: s.r }
}

/** The piece between t0 and t1 (t0 < t1), same direction. */
export function dSub(s: DSeg, t0: number, t1: number): DSeg {
  if (s.kind === 'line') return { kind: 'line', a: dPoint(s, t0), b: dPoint(s, t1) }
  return { kind: 'arc', c: s.c, r: s.r, a0: s.a0 + s.sweep * t0, sweep: s.sweep * (t1 - t0) }
}

export const bulgeOf = (s: DSeg): number => (s.kind === 'line' ? 0 : Math.tan(s.sweep / 4))

/** A polyline's directed segments; zero-length ones are dropped. */
export function polySegs(vertices: readonly PolyVertex[], closed: boolean): DSeg[] {
  const out: DSeg[] = []
  const n = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < n; i++) {
    const p = vertices[i]
    const q = vertices[(i + 1) % vertices.length]
    if (dist(p, q) < EPS) continue
    out.push(dsegFromBulge(p, q, p.bulge))
  }
  return out
}

/** Directed segments back to polyline vertices (an open run: the last end becomes the last vertex). */
export function segsToVertices(segs: readonly DSeg[], closed: boolean): PolyVertex[] {
  const out: PolyVertex[] = []
  for (const s of segs) {
    const p = dStart(s)
    out.push({ x: p.x, y: p.y, bulge: bulgeOf(s) })
  }
  if (!closed && segs.length > 0) {
    const e = dEnd(segs[segs.length - 1])
    out.push({ x: e.x, y: e.y, bulge: 0 })
  }
  return out
}

/**
 * The part of a run of segments between path parameters u0 < u1, where the
 * path parameter is segment index + t. Used by TRIM on polylines.
 */
export function sliceRun(segs: readonly DSeg[], u0: number, u1: number): DSeg[] {
  const out: DSeg[] = []
  const i0 = Math.max(0, Math.floor(u0))
  const i1 = Math.min(segs.length - 1, Math.ceil(u1) - 1)
  for (let i = i0; i <= i1; i++) {
    const t0 = Math.max(0, u0 - i)
    const t1 = Math.min(1, u1 - i)
    if (t1 - t0 < 1e-12) continue
    out.push(t0 === 0 && t1 === 1 ? segs[i] : dSub(segs[i], t0, t1))
  }
  return out
}
