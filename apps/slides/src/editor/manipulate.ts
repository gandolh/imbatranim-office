/**
 * Direct manipulation as pure functions on shape frames (EMU): move, resize
 * from any of eight handles (keeping the opposite side fixed, in the shape's
 * own rotated axes), rotate about the centre, drag a line's ends, marquee.
 */
import type { Xfrm } from '../engine/shapes'

export type Point = { x: number; y: number }

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** The smallest a resize can make a shape (one point). */
export const MIN_SIZE = 12700

const rad = (deg: number) => (deg * Math.PI) / 180

function rotate(p: Point, deg: number): Point {
  const a = rad(deg)
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }
}

export function center(b: Xfrm): Point {
  return { x: b.x + b.cx / 2, y: b.y + b.cy / 2 }
}

/** Move by (dx, dy); with `constrain`, along the dominant axis only. */
export function moveBy(b: Xfrm, dx: number, dy: number, constrain = false): Xfrm {
  if (constrain) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0
    else dx = 0
  }
  return { ...b, x: b.x + dx, y: b.y + dy }
}

const SIGN: Record<Handle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
}

/**
 * Resize by dragging `handle` to `pointer` (slide coordinates). The opposite
 * handle stays put; `keepAspect` holds the proportions (corners only);
 * `fromCenter` grows both sides symmetrically.
 */
export function resize(
  b: Xfrm,
  handle: Handle,
  pointer: Point,
  keepAspect: boolean,
  fromCenter: boolean
): Xfrm {
  const [sx, sy] = SIGN[handle]
  const c = center(b)
  // The pointer in the shape's own axes, relative to its centre.
  const local = rotate({ x: pointer.x - c.x, y: pointer.y - c.y }, -b.rot)
  const half = { x: b.cx / 2, y: b.cy / 2 }
  // The anchor: the opposite side (or the centre).
  const anchor = fromCenter ? { x: 0, y: 0 } : { x: -sx * half.x, y: -sy * half.y }
  let w = b.cx
  let h = b.cy
  if (sx !== 0)
    w = Math.max(MIN_SIZE, fromCenter ? Math.abs(local.x) * 2 : Math.abs(local.x - anchor.x))
  if (sy !== 0)
    h = Math.max(MIN_SIZE, fromCenter ? Math.abs(local.y) * 2 : Math.abs(local.y - anchor.y))
  if (keepAspect && sx !== 0 && sy !== 0 && b.cx > 0 && b.cy > 0) {
    const ratio = b.cx / b.cy
    if (w / h > ratio) h = w / ratio
    else w = h * ratio
  }
  // The new centre, in local axes: halfway from the anchor towards the handle side.
  const localCenter = fromCenter
    ? { x: 0, y: 0 }
    : {
        x: sx === 0 ? 0 : anchor.x + (sx * w) / 2,
        y: sy === 0 ? 0 : anchor.y + (sy * h) / 2,
      }
  const moved = rotate(localCenter, b.rot)
  const nc = { x: c.x + moved.x, y: c.y + moved.y }
  return { ...b, x: nc.x - w / 2, y: nc.y - h / 2, cx: w, cy: h }
}

/** Rotate so the handle above the shape points at `pointer`; `snap` to 15°. */
export function rotateTo(b: Xfrm, pointer: Point, snap: boolean): Xfrm {
  const c = center(b)
  let deg = (Math.atan2(pointer.y - c.y, pointer.x - c.x) * 180) / Math.PI + 90
  if (snap) deg = Math.round(deg / 15) * 15
  deg = ((deg % 360) + 360) % 360
  return { ...b, rot: Math.round(deg * 100) / 100 }
}

/** A line's two ends, in slide coordinates (its flips say which corner is which). */
export function lineEnds(b: Xfrm): [Point, Point] {
  const x1 = b.flipH ? b.x + b.cx : b.x
  const x2 = b.flipH ? b.x : b.x + b.cx
  const y1 = b.flipV ? b.y + b.cy : b.y
  const y2 = b.flipV ? b.y : b.y + b.cy
  return [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ]
}

/** The frame of a line between two points. */
export function lineBetween(b: Xfrm, a: Point, z: Point): Xfrm {
  return {
    ...b,
    x: Math.min(a.x, z.x),
    y: Math.min(a.y, z.y),
    cx: Math.abs(z.x - a.x),
    cy: Math.abs(z.y - a.y),
    rot: 0,
    flipH: z.x < a.x,
    flipV: z.y < a.y,
  }
}

/** The axis-aligned bounds of a rotated frame. */
export function bounds(b: Xfrm): { x: number; y: number; cx: number; cy: number } {
  if (!b.rot) return { x: b.x, y: b.y, cx: b.cx, cy: b.cy }
  const c = center(b)
  const pts = [
    { x: -b.cx / 2, y: -b.cy / 2 },
    { x: b.cx / 2, y: -b.cy / 2 },
    { x: b.cx / 2, y: b.cy / 2 },
    { x: -b.cx / 2, y: b.cy / 2 },
  ].map((p) => rotate(p, b.rot))
  const xs = pts.map((p) => p.x + c.x)
  const ys = pts.map((p) => p.y + c.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, cx: Math.max(...xs) - x, cy: Math.max(...ys) - y }
}

/** True when frame `b` lies wholly inside the marquee rectangle `r`. */
export function insideMarquee(
  b: Xfrm,
  r: { x: number; y: number; cx: number; cy: number }
): boolean {
  const o = bounds(b)
  return o.x >= r.x && o.y >= r.y && o.x + o.cx <= r.x + r.cx && o.y + o.cy <= r.y + r.cy
}

/** The rectangle two drag points span. */
export function spanRect(a: Point, z: Point) {
  return {
    x: Math.min(a.x, z.x),
    y: Math.min(a.y, z.y),
    cx: Math.abs(z.x - a.x),
    cy: Math.abs(z.y - a.y),
  }
}
