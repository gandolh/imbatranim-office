import { describe, expect, it } from 'vitest'
import {
  bounds,
  insideMarquee,
  lineBetween,
  lineEnds,
  moveBy,
  resize,
  rotateTo,
  spanRect,
} from './manipulate'
import type { Xfrm } from '../engine/shapes'

// Frames in EMU; K makes the arithmetic readable (100 units = 1,000,000 EMU).
const K = 10_000
const box: Xfrm = { x: 0, y: 0, cx: 100 * K, cy: 50 * K, rot: 0, flipH: false, flipV: false }
const pt = (x: number, y: number) => ({ x: x * K, y: y * K })
const scaled = (o: Record<string, number | boolean>) =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [
      k,
      typeof v === 'number' && !['rot'].includes(k) ? v * K : v,
    ])
  )

describe('direct manipulation', () => {
  it('moves, and with Shift along the dominant axis only', () => {
    expect(moveBy(box, 10 * K, 3 * K)).toMatchObject(scaled({ x: 10, y: 3 }))
    expect(moveBy(box, 10 * K, 3 * K, true)).toMatchObject(scaled({ x: 10, y: 0 }))
  })

  it('resizes from a corner keeping the opposite corner fixed', () => {
    expect(resize(box, 'se', pt(150, 80), false, false)).toMatchObject(
      scaled({ x: 0, y: 0, cx: 150, cy: 80 })
    )
    expect(resize(box, 'nw', pt(-20, -10), false, false)).toMatchObject(
      scaled({ x: -20, y: -10, cx: 120, cy: 60 })
    )
  })

  it('resizes from an edge in one direction only', () => {
    expect(resize(box, 'e', pt(140, 999), false, false)).toMatchObject(
      scaled({ x: 0, y: 0, cx: 140, cy: 50 })
    )
  })

  it('keeps the proportions when asked, and grows from the centre with Ctrl', () => {
    const r = resize(box, 'se', pt(200, 60), true, false)
    expect(r.cx / r.cy).toBeCloseTo(2)
    expect(resize(box, 'e', pt(70, 25), false, true)).toMatchObject(scaled({ x: 30, cx: 40 }))
  })

  it('resizes a rotated shape along its own axes', () => {
    const rotated = { ...box, rot: 90 }
    // Rotated 90°, the shape's "east" edge points down the slide.
    const r = resize(rotated, 'e', pt(50, 95), false, false)
    expect(r.cx / K).toBeCloseTo(120)
    expect(r.cy / K).toBeCloseTo(50)
  })

  it('rotates toward the pointer and snaps to 15° with Shift', () => {
    expect(rotateTo(box, pt(150, 25), false).rot).toBeCloseTo(90)
    expect(rotateTo(box, pt(150, 30), true).rot).toBe(90)
  })

  it('drags a line’s end, flipping its frame when it crosses over', () => {
    const [a, z] = lineEnds(box)
    expect(a).toEqual(pt(0, 0))
    expect(z).toEqual(pt(100, 50))
    expect(lineBetween(box, pt(100, 0), pt(0, 50))).toMatchObject(
      scaled({ x: 0, y: 0, cx: 100, cy: 50, flipH: true, flipV: false })
    )
  })

  it('selects with a marquee only what lies wholly inside it', () => {
    expect(insideMarquee(box, spanRect(pt(-1, -1), pt(101, 51)))).toBe(true)
    expect(insideMarquee(box, spanRect(pt(1, -1), pt(101, 51)))).toBe(false)
    const b = bounds({ ...box, rot: 90 })
    expect(b.cx / K).toBeCloseTo(50)
    expect(b.cy / K).toBeCloseTo(100)
  })
})
