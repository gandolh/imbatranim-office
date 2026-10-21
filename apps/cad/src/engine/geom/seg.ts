/**
 * The curves every geometric operation works on: a line segment, a
 * counter-clockwise circular arc and a full circle. Entities break down into
 * these (a polyline into one per vertex), and trim, extend, offset, fillet and
 * the snaps are written once against them. Everything here is exact; nothing
 * is tessellated.
 */
import {
  EPS,
  TAU,
  add,
  angleOf,
  cross,
  dist,
  dot,
  len,
  mul,
  norm,
  normAngle,
  perp,
  polar,
  sub,
  type Vec,
} from './vec'

export type LineSeg = { kind: 'line'; a: Vec; b: Vec }
/** Counter-clockwise from `start` to `end` (radians). */
export type ArcSeg = { kind: 'arc'; c: Vec; r: number; start: number; end: number }
export type CircleSeg = { kind: 'circle'; c: Vec; r: number }
export type Seg = LineSeg | ArcSeg | CircleSeg

/** The counter-clockwise sweep from start to end, in (0, 2π]. */
export function sweepOf(start: number, end: number): number {
  const s = normAngle(end - start)
  return s < 1e-12 ? TAU : s
}

/** True when angle `a` lies on the CCW sweep from start to end (tolerance in radians). */
export function angleOnArc(a: number, start: number, end: number, tol = 1e-9): boolean {
  const sweep = sweepOf(start, end)
  const rel = normAngle(a - start)
  return rel <= sweep + tol || rel >= TAU - tol
}

export const arcStart = (s: ArcSeg): Vec => polar(s.c, s.r, s.start)
export const arcEnd = (s: ArcSeg): Vec => polar(s.c, s.r, s.end)
export const arcMid = (s: ArcSeg): Vec => polar(s.c, s.r, s.start + sweepOf(s.start, s.end) / 2)

/** The start point of a line or an arc; a circle has none. */
export function segStart(s: Seg): Vec | null {
  return s.kind === 'line' ? s.a : s.kind === 'arc' ? arcStart(s) : null
}
export function segEnd(s: Seg): Vec | null {
  return s.kind === 'line' ? s.b : s.kind === 'arc' ? arcEnd(s) : null
}

export function segLength(s: Seg): number {
  if (s.kind === 'line') return dist(s.a, s.b)
  if (s.kind === 'circle') return TAU * s.r
  return s.r * sweepOf(s.start, s.end)
}

/** Unit tangent in the direction of travel at the start (or end) of a line or arc. */
export function tangentAt(s: LineSeg | ArcSeg, which: 'start' | 'end'): Vec {
  if (s.kind === 'line') return norm(sub(s.b, s.a))
  const a = which === 'start' ? s.start : s.end
  return { x: -Math.sin(a), y: Math.cos(a) }
}

/**
 * A polyline segment from `p1` to `p2` with DXF bulge `b` (tan of a quarter of
 * the included angle; positive is counter-clockwise) as a line or an arc.
 */
export function bulgeSeg(p1: Vec, p2: Vec, b: number): LineSeg | ArcSeg {
  const d = dist(p1, p2)
  if (Math.abs(b) < 1e-12 || d < EPS) return { kind: 'line', a: p1, b: p2 }
  const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  const n = perp(norm(sub(p2, p1)))
  const c = add(m, mul(n, (d / 2) * ((1 - b * b) / (2 * b))))
  const r = (d * (1 + b * b)) / (4 * Math.abs(b))
  const a1 = angleOf(sub(p1, c))
  const a2 = angleOf(sub(p2, c))
  return b > 0
    ? { kind: 'arc', c, r, start: normAngle(a1), end: normAngle(a2) }
    : { kind: 'arc', c, r, start: normAngle(a2), end: normAngle(a1) }
}

/** The bulge of an arc travelled from `from` to the other end (`reversed` = clockwise). */
export function arcBulge(s: ArcSeg, reversed: boolean): number {
  const b = Math.tan(sweepOf(s.start, s.end) / 4)
  return reversed ? -b : b
}

/** The arc through three points, or null when they are collinear. */
export function arcThrough(p1: Vec, p2: Vec, p3: Vec): ArcSeg | null {
  const c = circumcenter(p1, p2, p3)
  if (!c) return null
  const r = dist(c, p1)
  const a1 = normAngle(angleOf(sub(p1, c)))
  const a3 = normAngle(angleOf(sub(p3, c)))
  const ccw = cross(sub(p2, p1), sub(p3, p1)) > 0
  return ccw ? { kind: 'arc', c, r, start: a1, end: a3 } : { kind: 'arc', c, r, start: a3, end: a1 }
}

export function circumcenter(p1: Vec, p2: Vec, p3: Vec): Vec | null {
  const ax = p1.x
  const ay = p1.y
  const bx = p2.x - ax
  const by = p2.y - ay
  const cx = p3.x - ax
  const cy = p3.y - ay
  const d = 2 * (bx * cy - by * cx)
  const scale = Math.max(bx * bx + by * by, cx * cx + cy * cy)
  if (Math.abs(d) <= 1e-12 * Math.max(scale, 1e-300)) return null
  const b2 = bx * bx + by * by
  const c2 = cx * cx + cy * cy
  return { x: ax + (cy * b2 - by * c2) / d, y: ay + (bx * c2 - cx * b2) / d }
}

export type Closest = {
  point: Vec
  dist: number
  /** 0..1 along the segment (lines and arcs), an angle for circles. */ t: number
}

export function closestOnSeg(s: Seg, p: Vec): Closest {
  if (s.kind === 'line') {
    const d = sub(s.b, s.a)
    const l2 = dot(d, d)
    const t = l2 < EPS * EPS ? 0 : Math.min(1, Math.max(0, dot(sub(p, s.a), d) / l2))
    const point = { x: s.a.x + d.x * t, y: s.a.y + d.y * t }
    return { point, dist: dist(point, p), t }
  }
  const v = sub(p, s.c)
  const a = len(v) < EPS ? 0 : angleOf(v)
  if (s.kind === 'circle') {
    const point = polar(s.c, s.r, a)
    return { point, dist: dist(point, p), t: normAngle(a) }
  }
  if (angleOnArc(a, s.start, s.end)) {
    const point = polar(s.c, s.r, a)
    return { point, dist: dist(point, p), t: arcParam(s, a) }
  }
  const ps = arcStart(s)
  const pe = arcEnd(s)
  return dist(ps, p) <= dist(pe, p)
    ? { point: ps, dist: dist(ps, p), t: 0 }
    : { point: pe, dist: dist(pe, p), t: 1 }
}

/** 0..1 along an arc for the angle `a` (assumed on the arc). */
export function arcParam(s: ArcSeg, a: number): number {
  const sweep = sweepOf(s.start, s.end)
  const rel = normAngle(a - s.start)
  return rel > sweep + 1e-12 ? (rel - TAU) / sweep : rel / sweep
}

export function pointAtParam(s: LineSeg | ArcSeg, t: number): Vec {
  if (s.kind === 'line') return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }
  return polar(s.c, s.r, s.start + sweepOf(s.start, s.end) * t)
}

/** Param of a point known to lie on the (possibly extended) segment. Lines: unbounded t; arcs: angle-based t. */
export function paramOf(s: LineSeg | ArcSeg, p: Vec): number {
  if (s.kind === 'line') {
    const d = sub(s.b, s.a)
    const l2 = dot(d, d)
    return l2 < EPS * EPS ? 0 : dot(sub(p, s.a), d) / l2
  }
  return arcParam(s, angleOf(sub(p, s.c)))
}

/** The part of a line or arc between params t0 < t1. */
export function subSeg(s: LineSeg | ArcSeg, t0: number, t1: number): LineSeg | ArcSeg {
  if (s.kind === 'line') return { kind: 'line', a: pointAtParam(s, t0), b: pointAtParam(s, t1) }
  const sweep = sweepOf(s.start, s.end)
  return {
    kind: 'arc',
    c: s.c,
    r: s.r,
    start: normAngle(s.start + sweep * t0),
    end: normAngle(s.start + sweep * t1),
  }
}

// ── Intersections ────────────────────────────────────────────────────────────

/** Where two infinite lines cross, or null when parallel. */
export function lineLine(a1: Vec, b1: Vec, a2: Vec, b2: Vec): Vec | null {
  const d1 = sub(b1, a1)
  const d2 = sub(b2, a2)
  const den = cross(d1, d2)
  if (Math.abs(den) <= 1e-12 * len(d1) * len(d2)) return null
  const t = cross(sub(a2, a1), d2) / den
  return { x: a1.x + d1.x * t, y: a1.y + d1.y * t }
}

/** Where an infinite line meets a circle (0, 1 or 2 points). */
export function lineCircle(a: Vec, b: Vec, c: Vec, r: number): Vec[] {
  const d = sub(b, a)
  const l = len(d)
  if (l < EPS) return []
  const u = { x: d.x / l, y: d.y / l }
  const f = sub(a, c)
  const proj = dot(f, u)
  const foot = { x: a.x - u.x * proj, y: a.y - u.y * proj }
  const h = dist(foot, c)
  const tol = 1e-9 * Math.max(1, r)
  if (h > r + tol) return []
  if (Math.abs(h - r) <= tol) return [foot]
  const k = Math.sqrt(r * r - h * h)
  return [
    { x: foot.x - u.x * k, y: foot.y - u.y * k },
    { x: foot.x + u.x * k, y: foot.y + u.y * k },
  ]
}

export function circleCircle(c1: Vec, r1: number, c2: Vec, r2: number): Vec[] {
  const d = dist(c1, c2)
  const tol = 1e-9 * Math.max(1, r1, r2)
  if (d < EPS) return []
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h2 = r1 * r1 - a * a
  const u = { x: (c2.x - c1.x) / d, y: (c2.y - c1.y) / d }
  const m = { x: c1.x + u.x * a, y: c1.y + u.y * a }
  if (h2 <= tol * Math.max(1, r1)) return [m]
  const h = Math.sqrt(h2)
  return [
    { x: m.x - u.y * h, y: m.y + u.x * h },
    { x: m.x + u.y * h, y: m.y - u.x * h },
  ]
}

/** Is `p` (known to lie on the segment's line or circle) within the segment? */
export function onSeg(s: Seg, p: Vec, tol = 1e-9): boolean {
  if (s.kind === 'circle') return true
  if (s.kind === 'line') {
    const t = paramOf(s, p)
    const l = dist(s.a, s.b)
    const tt = l > 0 ? tol / l : 0
    return t >= -tt && t <= 1 + tt
  }
  return angleOnArc(angleOf(sub(p, s.c)), s.start, s.end, tol / Math.max(s.r, EPS))
}

export type IntersectOptions = {
  /** Treat the first segment as its whole line or circle. */
  extendA?: boolean
  extendB?: boolean
}

/** Intersection points of two segments. */
export function intersect(a: Seg, b: Seg, opts: IntersectOptions = {}): Vec[] {
  let pts: Vec[]
  if (a.kind === 'line' && b.kind === 'line') {
    const p = lineLine(a.a, a.b, b.a, b.b)
    pts = p ? [p] : []
  } else if (a.kind === 'line') {
    const cb = b as ArcSeg | CircleSeg
    pts = lineCircle(a.a, a.b, cb.c, cb.r)
  } else if (b.kind === 'line') {
    pts = lineCircle(b.a, b.b, a.c, a.r)
  } else {
    pts = circleCircle(a.c, a.r, b.c, b.r)
  }
  const scale = segScale(a, b)
  return pts.filter(
    (p) =>
      (opts.extendA || onSeg(a, p, 1e-9 * scale)) && (opts.extendB || onSeg(b, p, 1e-9 * scale))
  )
}

function segScale(a: Seg, b: Seg): number {
  const vals = [a, b].flatMap((s) =>
    s.kind === 'line' ? [s.a.x, s.a.y, s.b.x, s.b.y] : [s.c.x, s.c.y, s.r]
  )
  return Math.max(1, ...vals.map(Math.abs))
}

/** Foot of the perpendicular from `p` to the segment's line or circle, if it lies on the segment. */
export function perpendicularFoot(s: Seg, p: Vec): Vec | null {
  if (s.kind === 'line') {
    const d = sub(s.b, s.a)
    const l2 = dot(d, d)
    if (l2 < EPS * EPS) return null
    const t = dot(sub(p, s.a), d) / l2
    if (t < -1e-9 || t > 1 + 1e-9) return null
    return { x: s.a.x + d.x * t, y: s.a.y + d.y * t }
  }
  const v = sub(p, s.c)
  if (len(v) < EPS) return null
  const a = angleOf(v)
  if (s.kind === 'arc' && !angleOnArc(a, s.start, s.end)) {
    const opposite = a + Math.PI
    return angleOnArc(opposite, s.start, s.end) ? polar(s.c, s.r, opposite) : null
  }
  return polar(s.c, s.r, a)
}

/** Axis-aligned bounds of a segment. */
export function segBounds(s: Seg): { minX: number; minY: number; maxX: number; maxY: number } {
  if (s.kind === 'line') {
    return {
      minX: Math.min(s.a.x, s.b.x),
      minY: Math.min(s.a.y, s.b.y),
      maxX: Math.max(s.a.x, s.b.x),
      maxY: Math.max(s.a.y, s.b.y),
    }
  }
  if (s.kind === 'circle') {
    return { minX: s.c.x - s.r, minY: s.c.y - s.r, maxX: s.c.x + s.r, maxY: s.c.y + s.r }
  }
  const ps = arcStart(s)
  const pe = arcEnd(s)
  let minX = Math.min(ps.x, pe.x)
  let minY = Math.min(ps.y, pe.y)
  let maxX = Math.max(ps.x, pe.x)
  let maxY = Math.max(ps.y, pe.y)
  for (let q = 0; q < 4; q++) {
    const a = (q * Math.PI) / 2
    if (angleOnArc(a, s.start, s.end)) {
      const p = polar(s.c, s.r, a)
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  return { minX, minY, maxX, maxY }
}
