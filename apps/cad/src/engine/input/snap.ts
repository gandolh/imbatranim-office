/**
 * Object snaps. Given the segments near the cursor, find the point the
 * cursor should lock to. The rules, after AutoCAD's running snaps:
 *
 * 1. Endpoint, midpoint and intersection snap when their point is inside the
 *    aperture (a box of `aperture` drawing units round the cursor), and so
 *    does center when the centre itself is.
 * 2. Center also snaps while the cursor rests on the circle or arc (the
 *    marker shows at the centre); perpendicular snaps while the cursor rests
 *    on an object and there is a base point to drop the perpendicular from.
 * 3. Nearest, the point on the object closest to the cursor, comes last.
 *
 * Within a rule the candidate closest to the cursor wins; an earlier rule
 * always beats a later one, so a corner is never lost to "nearest".
 */
import {
  arcEnd,
  arcMid,
  arcStart,
  closestOnSeg,
  intersect,
  perpendicularFoot,
  type Seg,
} from '../geom/seg'
import { dist, mid, type Vec } from '../geom/vec'

export type SnapMode =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'intersection'
  | 'perpendicular'
  | 'nearest'

export const SNAP_MODES: readonly SnapMode[] = [
  'endpoint',
  'midpoint',
  'center',
  'intersection',
  'perpendicular',
  'nearest',
]

export const SNAP_LABEL: Record<SnapMode, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Center',
  intersection: 'Intersection',
  perpendicular: 'Perpendicular',
  nearest: 'Nearest',
}

export type SnapHit = { mode: SnapMode; point: Vec }

export type SnapQuery = {
  segs: readonly Seg[]
  /** Extra endpoint candidates (POINT entities, insertion points). */
  points?: readonly Vec[]
  cursor: Vec
  /** Half-size of the aperture box, drawing units. */
  aperture: number
  modes: ReadonlySet<SnapMode>
  /** The point the current prompt measures from (for perpendicular). */
  base?: Vec | null
}

/** Pairwise intersections are capped: past this many nearby segments only the closest are crossed. */
const MAX_INTERSECT_SEGS = 60

const inBox = (p: Vec, c: Vec, h: number) => Math.abs(p.x - c.x) <= h && Math.abs(p.y - c.y) <= h

export function findSnap(q: SnapQuery): SnapHit | null {
  const { cursor, aperture: h, modes } = q
  let best: { hit: SnapHit; tier: number; d: number } | null = null
  const offer = (mode: SnapMode, point: Vec, tier: number, d = dist(point, cursor)) => {
    if (!modes.has(mode)) return
    if (!best || tier < best.tier || (tier === best.tier && d < best.d))
      best = { hit: { mode, point }, tier, d }
  }
  const near: { seg: Seg; d: number }[] = []
  for (const s of q.segs) {
    const c = closestOnSeg(s, cursor)
    if (c.dist > h * Math.SQRT2) continue
    near.push({ seg: s, d: c.dist })
    if (s.kind === 'line') {
      if (inBox(s.a, cursor, h)) offer('endpoint', s.a, 1)
      if (inBox(s.b, cursor, h)) offer('endpoint', s.b, 1)
      const m = mid(s.a, s.b)
      if (inBox(m, cursor, h)) offer('midpoint', m, 1)
    } else if (s.kind === 'arc') {
      const ps = arcStart(s)
      const pe = arcEnd(s)
      const pm = arcMid(s)
      if (inBox(ps, cursor, h)) offer('endpoint', ps, 1)
      if (inBox(pe, cursor, h)) offer('endpoint', pe, 1)
      if (inBox(pm, cursor, h)) offer('midpoint', pm, 1)
    }
    if (s.kind !== 'line') {
      // Resting on the curve shows its centre.
      if (c.dist <= h) offer('center', s.c, 2, c.dist)
    }
    if (c.dist <= h) {
      if (q.base) {
        const foot = perpendicularFoot(s, q.base)
        if (foot && dist(foot, q.base) > 1e-12) offer('perpendicular', foot, 2, c.dist)
      }
      offer('nearest', c.point, 3, c.dist)
    }
  }
  for (const s of q.segs) {
    if (s.kind !== 'line' && inBox(s.c, cursor, h)) offer('center', s.c, 1)
  }
  for (const p of q.points ?? []) if (inBox(p, cursor, h)) offer('endpoint', p, 1)
  if (modes.has('intersection') && near.length > 1) {
    near.sort((a, b) => a.d - b.d)
    const list = near.slice(0, MAX_INTERSECT_SEGS)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        for (const p of intersect(list[i].seg, list[j].seg))
          if (inBox(p, cursor, h)) offer('intersection', p, 1)
      }
    }
  }
  return (best as { hit: SnapHit } | null)?.hit ?? null
}

// ── Ortho and polar tracking ─────────────────────────────────────────────────

/** Ortho (F8): the point straight across or straight up from the base, whichever the cursor is nearer. */
export function orthoPoint(base: Vec, p: Vec): Vec {
  return Math.abs(p.x - base.x) >= Math.abs(p.y - base.y)
    ? { x: p.x, y: base.y }
    : { x: base.x, y: p.y }
}

export type PolarHit = { point: Vec; angle: number; distance: number }

/**
 * Polar tracking: when the cursor is within `tolerance` (drawing units,
 * measured across the path) of a ray from the base at a multiple of
 * `increment`, the point on that ray.
 */
export function polarPoint(
  base: Vec,
  p: Vec,
  increment: number,
  tolerance: number
): PolarHit | null {
  const dx = p.x - base.x
  const dy = p.y - base.y
  const r = Math.hypot(dx, dy)
  if (r < tolerance || increment <= 0) return null
  const a = Math.atan2(dy, dx)
  const k = Math.round(a / increment)
  const ra = k * increment
  const along = dx * Math.cos(ra) + dy * Math.sin(ra)
  const across = Math.abs(-dx * Math.sin(ra) + dy * Math.cos(ra))
  if (along <= 0 || across > tolerance) return null
  return {
    point: { x: base.x + along * Math.cos(ra), y: base.y + along * Math.sin(ra) },
    angle: ra,
    distance: along,
  }
}
