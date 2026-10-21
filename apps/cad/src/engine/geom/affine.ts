/** A 2D affine map: x' = a·x + c·y + e, y' = b·x + d·y + f (the canvas convention). */
import type { Vec } from './vec'

export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export const apply = (m: Affine, p: Vec): Vec => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
})

/** The linear part only (for direction vectors). */
export const applyLinear = (m: Affine, v: Vec): Vec => ({
  x: m.a * v.x + m.c * v.y,
  y: m.b * v.x + m.d * v.y,
})

/** `outer ∘ inner`: apply `inner` first. */
export function compose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  }
}

export const translation = (dx: number, dy: number): Affine => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: dx,
  f: dy,
})

export function rotation(angle: number, about: Vec = { x: 0, y: 0 }): Affine {
  const cs = Math.cos(angle)
  const sn = Math.sin(angle)
  return {
    a: cs,
    b: sn,
    c: -sn,
    d: cs,
    e: about.x - cs * about.x + sn * about.y,
    f: about.y - sn * about.x - cs * about.y,
  }
}

export function scaling(s: number, about: Vec = { x: 0, y: 0 }): Affine {
  return { a: s, b: 0, c: 0, d: s, e: about.x * (1 - s), f: about.y * (1 - s) }
}

/** Reflection in the line through p1 and p2. */
export function mirroring(p1: Vec, p2: Vec): Affine {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return IDENTITY
  const cos2 = (dx * dx - dy * dy) / l2
  const sin2 = (2 * dx * dy) / l2
  const m: Affine = { a: cos2, b: sin2, c: sin2, d: -cos2, e: 0, f: 0 }
  const moved = apply(m, p1)
  return { ...m, e: p1.x - moved.x, f: p1.y - moved.y }
}

export const determinant = (m: Affine): number => m.a * m.d - m.b * m.c

/** The uniform scale of a similarity map (sqrt of |det|). */
export const scaleOf = (m: Affine): number => Math.sqrt(Math.abs(determinant(m)))

/** The angle a similarity map turns the +X axis by. */
export const rotationOf = (m: Affine): number => Math.atan2(m.b, m.a)

/** True when the map keeps circles circles (no shear, equal axis scales). */
export function isSimilarity(m: Affine): boolean {
  const s1 = Math.hypot(m.a, m.b)
  const s2 = Math.hypot(m.c, m.d)
  const tol = 1e-9 * Math.max(1, s1, s2)
  return Math.abs(s1 - s2) <= tol && Math.abs(m.a * m.c + m.b * m.d) <= tol * Math.max(1, s1 * s2)
}
