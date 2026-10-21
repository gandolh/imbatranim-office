/** A point or a vector in drawing units. Angles are radians, counter-clockwise from +X. */
export type Vec = { readonly x: number; readonly y: number }

/** Absolute tolerance for "the same point" in drawing units. */
export const EPS = 1e-9
export const TAU = Math.PI * 2

export const vec = (x: number, y: number): Vec => ({ x, y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x
export const len = (a: Vec): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})
/** The vector turned a quarter to the left. */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x })
export const angleOf = (a: Vec): number => Math.atan2(a.y, a.x)
export const angleFrom = (from: Vec, to: Vec): number => Math.atan2(to.y - from.y, to.x - from.x)

export function norm(a: Vec): Vec {
  const l = len(a)
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

/** The point `d` away from `p` at angle `a`. */
export const polar = (p: Vec, d: number, a: number): Vec => ({
  x: p.x + d * Math.cos(a),
  y: p.y + d * Math.sin(a),
})

export function rotate(v: Vec, a: number): Vec {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

export const rotateAbout = (p: Vec, center: Vec, a: number): Vec =>
  add(center, rotate(sub(p, center), a))

export const near = (a: Vec, b: Vec, tol = EPS): boolean => dist(a, b) <= tol

/** An angle in [0, 2π). */
export function normAngle(a: number): number {
  const r = a % TAU
  return r < 0 ? r + TAU : r
}

export const toRadians = (deg: number): number => (deg * Math.PI) / 180
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI

/** Scale-aware tolerance: EPS, grown with the magnitude of the coordinates involved. */
export function tolFor(...values: number[]): number {
  let m = 1
  for (const v of values) m = Math.max(m, Math.abs(v))
  return EPS * m
}
