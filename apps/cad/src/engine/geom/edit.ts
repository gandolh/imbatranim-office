/**
 * OFFSET, TRIM, EXTEND and FILLET on lines, arcs, circles and polylines.
 * Each takes an entity and returns its replacement geometry (or a reason it
 * cannot), leaving the document alone; the commands apply the result.
 * Everything is exact: intersections are closed-form, arcs stay arcs.
 */
import type { ArcEntity, CircleEntity, Entity, LineEntity, PolylineEntity } from '../model/types'
import {
  bulgeOf,
  dCarrier,
  dEnd,
  dParam,
  dPoint,
  dStart,
  dTangent,
  dToSeg,
  polySegs,
  segsToVertices,
  sliceRun,
  type DArc,
  type DSeg,
} from './path'
import {
  arcEnd,
  arcStart,
  circleCircle,
  closestOnSeg,
  intersect,
  lineCircle,
  lineLine,
  sweepOf,
  type Seg,
} from './seg'
import {
  EPS,
  TAU,
  add,
  angleOf,
  cross,
  dist,
  dot,
  mul,
  norm,
  normAngle,
  perp,
  polar,
  sub,
  type Vec,
} from './vec'

/** Geometry of a line, arc, circle or polyline without its common properties. */
export type LineShape = Pick<LineEntity, 'kind' | 'a' | 'b'>
export type CircleShape = Pick<CircleEntity, 'kind' | 'c' | 'r'>
export type ArcShape = Pick<ArcEntity, 'kind' | 'c' | 'r' | 'start' | 'end'>
export type PolylineShape = Pick<PolylineEntity, 'kind' | 'vertices' | 'closed' | 'width'>
export type CurveShape = LineShape | CircleShape | ArcShape | PolylineShape

export type Curve = LineEntity | CircleEntity | ArcEntity | PolylineEntity

export const isCurve = (e: Entity): e is Curve =>
  e.kind === 'line' || e.kind === 'circle' || e.kind === 'arc' || e.kind === 'polyline'

/** Parameter slack: intersections this close to an end do not count as cuts. */
const T_EPS = 1e-9

function arcShape(c: Vec, r: number, start: number, end: number): ArcShape {
  return { kind: 'arc', c, r, start: normAngle(start), end: normAngle(end) }
}

// ── OFFSET ───────────────────────────────────────────────────────────────────

/**
 * A copy of `e` at distance `d`, on the side of `side`. Polyline corners are
 * rejoined where the offset segments meet, and arc segments get the bulge
 * their new end points need.
 */
export function offsetCurve(e: Curve, d: number, side: Vec): CurveShape | string {
  if (!(d > 0)) return 'The offset distance must be greater than zero.'
  switch (e.kind) {
    case 'line': {
      const n = perp(norm(sub(e.b, e.a)))
      const s = dot(sub(side, e.a), n) >= 0 ? 1 : -1
      const v = mul(n, d * s)
      return { kind: 'line', a: add(e.a, v), b: add(e.b, v) }
    }
    case 'circle': {
      const r = dist(side, e.c) >= e.r ? e.r + d : e.r - d
      return r > EPS ? { kind: 'circle', c: e.c, r } : 'The offset would be smaller than nothing.'
    }
    case 'arc': {
      const r = dist(side, e.c) >= e.r ? e.r + d : e.r - d
      return r > EPS
        ? arcShape(e.c, r, e.start, e.end)
        : 'The offset would be smaller than nothing.'
    }
    case 'polyline':
      return offsetPolyline(e, d, side)
  }
}

function offsetSeg(s: DSeg, delta: number): DSeg | null {
  if (s.kind === 'line') {
    const v = mul(perp(dTangent(s, 0)), delta)
    return { kind: 'line', a: add(s.a, v), b: add(s.b, v) }
  }
  // Left of a counter-clockwise arc is its centre.
  const r = s.sweep >= 0 ? s.r - delta : s.r + delta
  return r > EPS ? { ...s, r } : null
}

/** Where two consecutive offset segments should meet, near `hint`. */
function joinPoint(a: DSeg, b: DSeg, hint: Vec): Vec | null {
  const A = dCarrier(a)
  const B = dCarrier(b)
  let pts: Vec[]
  if (A.kind === 'line' && B.kind === 'line') {
    const p = lineLine(A.a, A.b, B.a, B.b)
    pts = p ? [p] : []
  } else if (A.kind === 'line' && B.kind === 'circle') pts = lineCircle(A.a, A.b, B.c, B.r)
  else if (A.kind === 'circle' && B.kind === 'line') pts = lineCircle(B.a, B.b, A.c, A.r)
  else if (A.kind === 'circle' && B.kind === 'circle') pts = circleCircle(A.c, A.r, B.c, B.r)
  else pts = []
  if (pts.length === 0) return null
  return pts.reduce((best, p) => (dist(p, hint) < dist(best, hint) ? p : best))
}

/** Re-aim a directed segment so it runs from `from` to `to` (both on its line or circle). */
function retarget(s: DSeg, from: Vec, to: Vec): DSeg {
  if (s.kind === 'line') return { kind: 'line', a: from, b: to }
  const a0 = angleOf(sub(from, s.c))
  const a1 = angleOf(sub(to, s.c))
  let sweep = s.sweep >= 0 ? normAngle(a1 - a0) : -normAngle(a0 - a1)
  // Keep the turn the original took when it was (nearly) whole.
  if (Math.abs(sweep) < 1e-12) sweep = s.sweep >= 0 ? TAU : -TAU
  return { kind: 'arc', c: s.c, r: s.r, a0, sweep }
}

function offsetPolyline(e: PolylineEntity, d: number, side: Vec): PolylineShape | string {
  const segs = polySegs(e.vertices, e.closed)
  if (segs.length === 0) return 'The polyline has no length.'
  // Which side: left or right of the direction of travel at the closest point.
  let best = { i: 0, t: 0, dist: Infinity }
  segs.forEach((s, i) => {
    const c = closestOnSeg(dToSeg(s), side)
    if (c.dist < best.dist)
      best = { i, t: Math.min(1, Math.max(0, dParam(s, c.point))), dist: c.dist }
  })
  const at = dPoint(segs[best.i], best.t)
  const sign = cross(dTangent(segs[best.i], best.t), sub(side, at)) >= 0 ? 1 : -1
  const delta = d * sign
  const moved: DSeg[] = []
  for (const s of segs) {
    const o = offsetSeg(s, delta)
    if (!o) return 'An arc of the polyline would shrink to nothing.'
    moved.push(o)
  }
  const n = moved.length
  const starts: Vec[] = moved.map(dStart)
  const ends: Vec[] = moved.map(dEnd)
  const out: DSeg[] = []
  // Corners: each segment's start meets the previous segment's end.
  const cornerCount = e.closed ? n : n - 1
  const corner: (Vec | null)[] = new Array(n).fill(null)
  for (let k = 0; k < cornerCount; k++) {
    const i = k
    const j = (k + 1) % n
    const hint = { x: (ends[i].x + starts[j].x) / 2, y: (ends[i].y + starts[j].y) / 2 }
    corner[j] =
      dist(ends[i], starts[j]) < 1e-9 * Math.max(1, d)
        ? ends[i]
        : joinPoint(moved[i], moved[j], hint)
  }
  for (let i = 0; i < n; i++) {
    const from = corner[i] ?? starts[i]
    const nextCorner = e.closed || i < n - 1 ? corner[(i + 1) % n] : null
    const to = nextCorner ?? ends[i]
    out.push(retarget(moved[i], from, to))
    // No corner point: bridge the gap with a straight piece.
    if (nextCorner === null && (e.closed || i < n - 1)) {
      const j = (i + 1) % n
      if (dist(ends[i], starts[j]) > EPS) out.push({ kind: 'line', a: ends[i], b: starts[j] })
    }
  }
  return {
    kind: 'polyline',
    vertices: segsToVertices(out, e.closed),
    closed: e.closed,
    width: e.width,
  }
}

// ── TRIM ─────────────────────────────────────────────────────────────────────

function cutParams(target: DSeg, cutters: readonly Seg[], lo: number, hi: number): number[] {
  const seg = dToSeg(target)
  const out: number[] = []
  for (const c of cutters) {
    for (const p of intersect(seg, c)) {
      const t = dParam(target, p)
      if (t > lo + T_EPS && t < hi - T_EPS) out.push(t)
    }
  }
  return out.sort((a, b) => a - b)
}

/** Sorted, with values closer than `tol` merged (the first is kept, unrounded). */
function distinctSorted(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) if (out.length === 0 || v - out[out.length - 1] > tol) out.push(v)
  return out
}

export type TrimResult = { pieces: CurveShape[] }

/**
 * TRIM: remove the part of `e` around `pick` that lies between the nearest
 * cutting edges on either side. A line or arc with cuts on one side keeps the
 * far side; a circle needs two cuts and becomes an arc; a closed polyline
 * opens. `cutters` are the cutting edges (never extended).
 */
export function trimCurve(e: Curve, pick: Vec, cutters: readonly Seg[]): TrimResult | string {
  const noCut = 'The object does not cross a cutting edge there.'
  if (e.kind === 'circle') {
    const angles: number[] = []
    for (const c of cutters) {
      for (const p of intersect({ kind: 'circle', c: e.c, r: e.r }, c))
        angles.push(normAngle(angleOf(sub(p, e.c))))
    }
    const uniq = distinctSorted(angles, 1e-12)
    if (uniq.length < 2) return 'A circle needs two cutting edges to trim.'
    const ap = normAngle(angleOf(sub(pick, e.c)))
    // The cut just before the pick (going CCW) and the one just after.
    let before = uniq[uniq.length - 1]
    let after = uniq[0]
    for (const a of uniq) {
      if (a <= ap) before = a
    }
    for (let k = uniq.length - 1; k >= 0; k--) if (uniq[k] > ap) after = uniq[k]
    if (ap >= uniq[uniq.length - 1]) after = uniq[0]
    // Remove before→after; keep after→before.
    return { pieces: [arcShape(e.c, e.r, after, before)] }
  }
  const closed = e.kind === 'polyline' && e.closed
  const segs: DSeg[] =
    e.kind === 'line'
      ? [{ kind: 'line', a: e.a, b: e.b }]
      : e.kind === 'arc'
        ? [{ kind: 'arc', c: e.c, r: e.r, a0: e.start, sweep: sweepOf(e.start, e.end) }]
        : polySegs(e.vertices, e.closed)
  if (segs.length === 0) return noCut
  // Path parameter: segment index + t.
  const cuts: number[] = []
  segs.forEach((s, i) => {
    for (const t of cutParams(
      s,
      cutters,
      closed || i > 0 ? -T_EPS * 2 : 0,
      closed || i < segs.length - 1 ? 1 + T_EPS * 2 : 1
    )) {
      const u = i + Math.min(1, Math.max(0, t))
      if (!closed && (u <= T_EPS || u >= segs.length - T_EPS)) continue
      cuts.push(u)
    }
  })
  const uniq = distinctSorted(cuts, 1e-9)
  let pickU = 0
  let bestD = Infinity
  segs.forEach((s, i) => {
    const c = closestOnSeg(dToSeg(s), pick)
    if (c.dist < bestD) {
      bestD = c.dist
      pickU = i + Math.min(1, Math.max(0, dParam(s, c.point)))
    }
  })
  const total = segs.length
  const shape = (run: DSeg[]): CurveShape | null => {
    if (run.length === 0) return null
    if (e.kind === 'line') {
      const r = run[0] as Extract<DSeg, { kind: 'line' }>
      return { kind: 'line', a: r.a, b: r.b }
    }
    if (e.kind === 'arc') {
      const r = run[0] as DArc
      return arcShape(r.c, r.r, r.a0, r.a0 + r.sweep)
    }
    return { kind: 'polyline', vertices: segsToVertices(run, false), closed: false, width: e.width }
  }
  if (closed) {
    if (uniq.length < 2) return 'A closed polyline needs two cutting edges to trim.'
    let before = uniq[uniq.length - 1]
    let after = uniq[0]
    for (const u of uniq) if (u <= pickU) before = u
    for (let k = uniq.length - 1; k >= 0; k--) if (uniq[k] > pickU) after = uniq[k]
    if (pickU >= uniq[uniq.length - 1]) after = uniq[0]
    // Keep after → before, going round through the start.
    const run =
      after < before
        ? sliceRun(segs, after, before)
        : [...sliceRun(segs, after, total), ...sliceRun(segs, 0, before)]
    const s = shape(run)
    return s ? { pieces: [s] } : noCut
  }
  const lowCut = uniq.filter((u) => u < pickU).pop()
  const highCut = uniq.find((u) => u > pickU)
  if (lowCut === undefined && highCut === undefined) return noCut
  const pieces: CurveShape[] = []
  if (lowCut !== undefined) {
    const s = shape(sliceRun(segs, 0, lowCut))
    if (s) pieces.push(s)
  }
  if (highCut !== undefined) {
    const s = shape(sliceRun(segs, highCut, total))
    if (s) pieces.push(s)
  }
  return { pieces }
}

// ── EXTEND ───────────────────────────────────────────────────────────────────

/**
 * EXTEND: run the end of `e` nearest `pick` on along its line or circle to
 * the first boundary edge it meets. Works on lines, arcs and the end segments
 * of open polylines.
 */
export function extendCurve(e: Curve, pick: Vec, boundaries: readonly Seg[]): CurveShape | string {
  const none = 'The object does not meet a boundary edge if extended.'
  if (e.kind === 'circle') return 'A circle has no end to extend.'
  if (e.kind === 'polyline' && e.closed) return 'A closed polyline has no end to extend.'
  const segs: DSeg[] =
    e.kind === 'line'
      ? [{ kind: 'line', a: e.a, b: e.b }]
      : e.kind === 'arc'
        ? [{ kind: 'arc', c: e.c, r: e.r, a0: e.start, sweep: sweepOf(e.start, e.end) }]
        : polySegs(e.vertices, false)
  if (segs.length === 0) return none
  const first = segs[0]
  const last = segs[segs.length - 1]
  const atEnd = dist(pick, dEnd(last)) < dist(pick, dStart(first))
  const s = atEnd ? last : first
  // Candidate params beyond the chosen end along the carrier.
  const carrier = dCarrier(s)
  let bestT: number | null = null
  for (const b of boundaries) {
    for (const p of intersect(carrier, b, { extendA: true })) {
      if (s.kind === 'line') {
        const t = dParam(s, p)
        if (atEnd ? t > 1 + T_EPS : t < -T_EPS) {
          if (bestT === null || (atEnd ? t < bestT : t > bestT)) bestT = t
        }
      } else {
        // Along the circle beyond the end (or before the start), as a fraction of the sweep.
        const phi = angleOf(sub(p, s.c))
        const sw = Math.abs(s.sweep)
        const dir = s.sweep >= 0 ? 1 : -1
        const fromEnd = normAngle((phi - (s.a0 + s.sweep)) * dir)
        const beforeStart = normAngle((s.a0 - phi) * dir)
        const t = atEnd ? 1 + fromEnd / sw : -beforeStart / sw
        const ok = atEnd
          ? fromEnd > 1e-12 && fromEnd < TAU - sw
          : beforeStart > 1e-12 && beforeStart < TAU - sw
        if (ok && (bestT === null || (atEnd ? t < bestT : t > bestT))) bestT = t
      }
    }
  }
  if (bestT === null) return none
  const t0 = atEnd ? 0 : bestT
  const t1 = atEnd ? bestT : 1
  let grown: DSeg
  if (s.kind === 'line') grown = { kind: 'line', a: dPoint(s, t0), b: dPoint(s, t1) }
  else grown = { kind: 'arc', c: s.c, r: s.r, a0: s.a0 + s.sweep * t0, sweep: s.sweep * (t1 - t0) }
  if (e.kind === 'line') {
    const g = grown as Extract<DSeg, { kind: 'line' }>
    return { kind: 'line', a: g.a, b: g.b }
  }
  if (e.kind === 'arc') {
    const g = grown as DArc
    return arcShape(g.c, g.r, g.a0, g.a0 + g.sweep)
  }
  const run = atEnd ? [...segs.slice(0, -1), grown] : [grown, ...segs.slice(1)]
  return { kind: 'polyline', vertices: segsToVertices(run, false), closed: false, width: e.width }
}

// ── FILLET ───────────────────────────────────────────────────────────────────

export type FilletResult = {
  first: CurveShape
  second: CurveShape
  /** The rounding arc (radius > 0). */
  arc?: ArcShape
}

type Trimmable = LineEntity | ArcEntity

/** Make a line end at `to`, keeping the end on the picked side. */
function lineTo(e: LineEntity, pick: Vec, to: Vec): LineShape | string {
  const u = norm(sub(e.b, e.a))
  const tp = dot(sub(pick, to), u)
  const ta = dot(sub(e.a, to), u)
  const tb = dot(sub(e.b, to), u)
  // The kept end is the one on the same side of `to` as the pick.
  const sideA = Math.sign(ta) === Math.sign(tp) || Math.abs(tp) < EPS ? Math.abs(ta) : -1
  const sideB = Math.sign(tb) === Math.sign(tp) || Math.abs(tp) < EPS ? Math.abs(tb) : -1
  if (sideA < 0 && sideB < 0) return 'The fillet point is not on the picked part of the line.'
  const keep = sideA >= sideB ? e.a : e.b
  if (dist(keep, to) < EPS) return 'The line would shrink to nothing.'
  return { kind: 'line', a: keep, b: to }
}

/** Make an arc end at `to` (on its circle), keeping the picked part. */
function arcTo(e: ArcEntity, pick: Vec, to: Vec): ArcShape | string {
  const phiTo = normAngle(angleOf(sub(to, e.c)))
  const phiPick = normAngle(angleOf(sub(pick, e.c)))
  const moveStart = arcShape(e.c, e.r, phiTo, e.end)
  const moveEnd = arcShape(e.c, e.r, e.start, phiTo)
  const contains = (a: ArcShape) => normAngle(phiPick - a.start) <= sweepOf(a.start, a.end) + 1e-9
  const asSeg = { kind: 'arc' as const, c: e.c, r: e.r, start: e.start, end: e.end }
  const sNear = dist(to, arcStart(asSeg)) <= dist(to, arcEnd(asSeg))
  const order = sNear ? [moveStart, moveEnd] : [moveEnd, moveStart]
  for (const cand of order) if (contains(cand)) return cand
  return order[0]
}

function trimTo(e: Trimmable, pick: Vec, to: Vec): LineShape | ArcShape | string {
  return e.kind === 'line' ? lineTo(e, pick, to) : arcTo(e, pick, to)
}

function carrierOf(e: Trimmable): Seg {
  return e.kind === 'line' ? { kind: 'line', a: e.a, b: e.b } : { kind: 'circle', c: e.c, r: e.r }
}

/**
 * FILLET two lines or arcs. Radius 0 trims or extends both to where they
 * meet; a radius joins them with a tangent arc and trims them to it. The pick
 * points say which part of each to keep.
 */
export function fillet(
  e1: Entity,
  pick1: Vec,
  e2: Entity,
  pick2: Vec,
  radius: number
): FilletResult | string {
  if (e1.handle === e2.handle) return 'Select two different objects.'
  const ok = (e: Entity): e is Trimmable => e.kind === 'line' || e.kind === 'arc'
  if (!ok(e1) || !ok(e2)) return 'FILLET works on lines and arcs.'
  if (radius < 0) return 'The radius must not be negative.'
  if (e1.kind === 'line' && e2.kind === 'line') return filletLines(e1, pick1, e2, pick2, radius)
  if (radius === 0) {
    const pts = intersect(carrierOf(e1), carrierOf(e2), { extendA: true, extendB: true })
    if (pts.length === 0) return 'The objects do not meet.'
    const X = pts.reduce((b, p) =>
      dist(p, pick1) + dist(p, pick2) < dist(b, pick1) + dist(b, pick2) ? p : b
    )
    const first = trimTo(e1, pick1, X)
    const second = trimTo(e2, pick2, X)
    if (typeof first === 'string') return first
    if (typeof second === 'string') return second
    return { first, second }
  }
  // Centres: where the two curves, each moved by the radius, cross.
  const offsets = (e: Trimmable): Seg[] => {
    if (e.kind === 'line') {
      const n = mul(perp(norm(sub(e.b, e.a))), radius)
      return [
        { kind: 'line', a: add(e.a, n), b: add(e.b, n) },
        { kind: 'line', a: sub(e.a, n), b: sub(e.b, n) },
      ]
    }
    const out: Seg[] = [{ kind: 'circle', c: e.c, r: e.r + radius }]
    if (e.r - radius > EPS) out.push({ kind: 'circle', c: e.c, r: e.r - radius })
    return out
  }
  const foot = (e: Trimmable, c: Vec): Vec => {
    if (e.kind === 'line') {
      const u = norm(sub(e.b, e.a))
      return add(e.a, mul(u, dot(sub(c, e.a), u)))
    }
    return polar(e.c, e.r, angleOf(sub(c, e.c)))
  }
  let best: { c: Vec; t1: Vec; t2: Vec; score: number } | null = null
  for (const a of offsets(e1)) {
    for (const b of offsets(e2)) {
      for (const c of intersect(a, b, { extendA: true, extendB: true })) {
        const t1 = foot(e1, c)
        const t2 = foot(e2, c)
        const score = dist(t1, pick1) + dist(t2, pick2)
        if (!best || score < best.score) best = { c, t1, t2, score }
      }
    }
  }
  if (!best) return 'The radius is too large for these objects.'
  const first = trimTo(e1, pick1, best.t1)
  const second = trimTo(e2, pick2, best.t2)
  if (typeof first === 'string') return first
  if (typeof second === 'string') return second
  return { first, second, arc: minorArc(best.c, radius, best.t1, best.t2) }
}

function minorArc(c: Vec, r: number, p: Vec, q: Vec): ArcShape {
  const a = angleOf(sub(p, c))
  const b = angleOf(sub(q, c))
  return normAngle(b - a) <= Math.PI ? arcShape(c, r, a, b) : arcShape(c, r, b, a)
}

function filletLines(
  l1: LineEntity,
  p1: Vec,
  l2: LineEntity,
  p2: Vec,
  r: number
): FilletResult | string {
  const X = lineLine(l1.a, l1.b, l2.a, l2.b)
  if (!X) return 'The lines are parallel.'
  if (r === 0) {
    const first = lineTo(l1, p1, X)
    const second = lineTo(l2, p2, X)
    if (typeof first === 'string') return first
    if (typeof second === 'string') return second
    return { first, second }
  }
  // Directions from the corner towards the kept parts.
  const dir = (l: LineEntity, pick: Vec): Vec => {
    const u = norm(sub(l.b, l.a))
    const s = dot(sub(pick, X), u)
    if (Math.abs(s) > EPS) return mul(u, Math.sign(s))
    return dist(l.a, X) > dist(l.b, X) ? norm(sub(l.a, X)) : norm(sub(l.b, X))
  }
  const u1 = dir(l1, p1)
  const u2 = dir(l2, p2)
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))))
  if (theta < 1e-9 || Math.PI - theta < 1e-9) return 'The lines are parallel.'
  const d = r / Math.tan(theta / 2)
  const reach = (l: LineEntity, u: Vec) => Math.max(dot(sub(l.a, X), u), dot(sub(l.b, X), u))
  if (d > reach(l1, u1) + EPS || d > reach(l2, u2) + EPS)
    return 'The radius is too large for these lines.'
  const T1 = add(X, mul(u1, d))
  const T2 = add(X, mul(u2, d))
  const c = add(X, mul(norm(add(u1, u2)), r / Math.sin(theta / 2)))
  const first = lineTo(l1, p1, T1)
  const second = lineTo(l2, p2, T2)
  if (typeof first === 'string') return first
  if (typeof second === 'string') return second
  return { first, second, arc: minorArc(c, r, T1, T2) }
}

export { bulgeOf }
