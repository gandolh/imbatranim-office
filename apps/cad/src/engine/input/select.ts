/**
 * Picking: what is under the cursor, and what a selection window takes.
 * A window (dragged left to right) takes what lies wholly inside it; a
 * crossing window (right to left) also takes what it touches.
 */
import { closestOnSeg, intersect, type Seg } from '../geom/seg'
import type { Vec } from '../geom/vec'
import type { Bounds, BlockLookup } from '../model/geometry'
import { entitySegs, textCorners } from '../model/geometry'
import type { Entity } from '../model/types'

/** Distance from a point to what is drawn for an entity (0 inside text). */
export function entityDistance(e: Entity, p: Vec, blocks: BlockLookup): number {
  const corners = textCorners(e)
  if (corners) {
    for (let i = 0; i + 3 < corners.length; i += 4)
      if (insideQuad(corners.slice(i, i + 4), p)) return 0
    let d = Infinity
    for (let i = 0; i + 3 < corners.length; i += 4) {
      for (let k = 0; k < 4; k++) {
        d = Math.min(
          d,
          closestOnSeg({ kind: 'line', a: corners[i + k], b: corners[i + ((k + 1) % 4)] }, p).dist
        )
      }
    }
    return d
  }
  if (e.kind === 'point') return Math.hypot(e.p.x - p.x, e.p.y - p.y)
  let d = Infinity
  for (const s of entitySegs(e, blocks)) d = Math.min(d, closestOnSeg(s, p).dist)
  if (e.kind === 'insert') for (const a of e.attribs) d = Math.min(d, entityDistance(a, p, blocks))
  return d
}

function insideQuad(q: Vec[], p: Vec): boolean {
  let inside = false
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (
      q[i].y > p.y !== q[j].y > p.y &&
      p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x
    )
      inside = !inside
  }
  return inside
}

export const boundsInside = (b: Bounds, r: Bounds): boolean =>
  b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY

const pointIn = (p: Vec, r: Bounds) =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY

/** Does what is drawn for the entity touch the rectangle? */
export function touchesRect(e: Entity, r: Bounds, blocks: BlockLookup): boolean {
  const corners = textCorners(e)
  const edges: Seg[] = [
    { kind: 'line', a: { x: r.minX, y: r.minY }, b: { x: r.maxX, y: r.minY } },
    { kind: 'line', a: { x: r.maxX, y: r.minY }, b: { x: r.maxX, y: r.maxY } },
    { kind: 'line', a: { x: r.maxX, y: r.maxY }, b: { x: r.minX, y: r.maxY } },
    { kind: 'line', a: { x: r.minX, y: r.maxY }, b: { x: r.minX, y: r.minY } },
  ]
  if (corners) {
    if (corners.some((c) => pointIn(c, r))) return true
    const center = { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }
    for (let i = 0; i + 3 < corners.length; i += 4)
      if (insideQuad(corners.slice(i, i + 4), center)) return true
    for (let i = 0; i + 3 < corners.length; i += 4) {
      for (let k = 0; k < 4; k++) {
        const s: Seg = { kind: 'line', a: corners[i + k], b: corners[i + ((k + 1) % 4)] }
        if (edges.some((ed) => intersect(s, ed).length > 0)) return true
      }
    }
    return false
  }
  if (e.kind === 'point') return pointIn(e.p, r)
  for (const s of entitySegs(e, blocks)) {
    const start = s.kind === 'line' ? s.a : null
    if (start && pointIn(start, r)) return true
    if (s.kind !== 'line') {
      const c = closestOnSeg(s, { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 })
      if (pointIn(c.point, r)) return true
    }
    if (edges.some((ed) => intersect(s, ed).length > 0)) return true
  }
  if (e.kind === 'insert') return e.attribs.some((a) => touchesRect(a, r, blocks))
  return false
}
