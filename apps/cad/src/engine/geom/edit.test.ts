import { describe, expect, it } from 'vitest'
import type { ArcEntity, CircleEntity, LineEntity, PolylineEntity } from '../model/types'
import { extendCurve, fillet, offsetCurve, trimCurve, type CurveShape } from './edit'
import type { Seg } from './seg'

const props = { layer: '0', color: 256, linetype: 'ByLayer' }
const line = (h: string, ax: number, ay: number, bx: number, by: number): LineEntity => ({
  ...props,
  handle: h,
  kind: 'line',
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
})
const seg = (ax: number, ay: number, bx: number, by: number): Seg => ({
  kind: 'line',
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
})
const P = (x: number, y: number) => ({ x, y })

function expectPoint(p: { x: number; y: number }, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 9)
  expect(p.y).toBeCloseTo(y, 9)
}

function ok<T>(r: T | string): T {
  if (typeof r === 'string') throw new Error(r)
  return r
}

describe('OFFSET', () => {
  it('moves a line to the picked side', () => {
    const r = ok(offsetCurve(line('1', 0, 0, 10, 0), 0.2, P(5, 3))) as Extract<
      CurveShape,
      { kind: 'line' }
    >
    expectPoint(r.a, 0, 0.2)
    expectPoint(r.b, 10, 0.2)
    const below = ok(offsetCurve(line('1', 0, 0, 10, 0), 0.2, P(5, -1))) as Extract<
      CurveShape,
      { kind: 'line' }
    >
    expectPoint(below.a, 0, -0.2)
  })

  it('grows or shrinks circles and arcs by the side', () => {
    const c: CircleEntity = { ...props, handle: '2', kind: 'circle', c: P(0, 0), r: 5 }
    expect(ok(offsetCurve(c, 1, P(10, 0)))).toEqual({ kind: 'circle', c: P(0, 0), r: 6 })
    expect(ok(offsetCurve(c, 1, P(1, 0)))).toEqual({ kind: 'circle', c: P(0, 0), r: 4 })
    expect(offsetCurve(c, 6, P(1, 0))).toMatch(/smaller than nothing/)
    const a: ArcEntity = {
      ...props,
      handle: '3',
      kind: 'arc',
      c: P(0, 0),
      r: 2,
      start: 0,
      end: Math.PI / 2,
    }
    const r = ok(offsetCurve(a, 0.5, P(3, 3))) as Extract<CurveShape, { kind: 'arc' }>
    expect(r.r).toBeCloseTo(2.5, 12)
    expect(r.start).toBeCloseTo(0, 12)
    expect(r.end).toBeCloseTo(Math.PI / 2, 12)
  })

  it('offsets a closed 10×8 rectangle inward with sharp corners', () => {
    const rect: PolylineEntity = {
      ...props,
      handle: '4',
      kind: 'polyline',
      vertices: [P(0, 0), P(10, 0), P(10, 8), P(0, 8)].map((p) => ({ ...p, bulge: 0 })),
      closed: true,
      width: 0,
    }
    const r = ok(offsetCurve(rect, 0.2, P(5, 4))) as PolylineEntity
    expect(r.closed).toBe(true)
    expect(r.vertices).toHaveLength(4)
    const want = [P(0.2, 0.2), P(9.8, 0.2), P(9.8, 7.8), P(0.2, 7.8)]
    r.vertices.forEach((v, i) => expectPoint(v, want[i].x, want[i].y))
    const out = ok(offsetCurve(rect, 0.2, P(-1, 4))) as PolylineEntity
    const wantOut = [P(-0.2, -0.2), P(10.2, -0.2), P(10.2, 8.2), P(-0.2, 8.2)]
    out.vertices.forEach((v, i) => expectPoint(v, wantOut[i].x, wantOut[i].y))
  })

  it('offsets a polyline arc segment and recomputes its bulge', () => {
    // A slot: straight, half circle (bulge 1), straight back, half circle.
    const slot: PolylineEntity = {
      ...props,
      handle: '5',
      kind: 'polyline',
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 1 },
        { x: 10, y: 4, bulge: 0 },
        { x: 0, y: 4, bulge: 1 },
      ],
      closed: true,
      width: 0,
    }
    const r = ok(offsetCurve(slot, 1, P(5, 2))) as PolylineEntity
    const want = [
      { x: 0, y: 1, bulge: 0 },
      { x: 10, y: 1, bulge: 1 },
      { x: 10, y: 3, bulge: 0 },
      { x: 0, y: 3, bulge: 1 },
    ]
    r.vertices.forEach((v, i) => {
      expectPoint(v, want[i].x, want[i].y)
      expect(v.bulge).toBeCloseTo(want[i].bulge, 9)
    })
  })
})

describe('TRIM', () => {
  it('removes the middle of a line between two cutting edges', () => {
    const r = ok(trimCurve(line('1', 0, 0, 10, 0), P(5, 0), [seg(3, -1, 3, 1), seg(7, -1, 7, 1)]))
    expect(r.pieces).toHaveLength(2)
    const [a, b] = r.pieces as Extract<CurveShape, { kind: 'line' }>[]
    expectPoint(a.a, 0, 0)
    expectPoint(a.b, 3, 0)
    expectPoint(b.a, 7, 0)
    expectPoint(b.b, 10, 0)
  })

  it('cuts the end off past the last cutting edge', () => {
    const r = ok(trimCurve(line('1', 0, 0, 10, 0), P(9, 0), [seg(3, -1, 3, 1), seg(7, -1, 7, 1)]))
    expect(r.pieces).toHaveLength(1)
    const [a] = r.pieces as Extract<CurveShape, { kind: 'line' }>[]
    expectPoint(a.a, 0, 0)
    expectPoint(a.b, 7, 0)
  })

  it('trims the 0.2 overhang at an offset room corner', () => {
    // Inner wall lines after OFFSET 0.2 of a 10×8 room: they cross near each corner.
    const bottom = line('b', 0, 0.2, 10, 0.2)
    const left = seg(0.2, 0, 0.2, 8)
    const right = seg(9.8, 0, 9.8, 8)
    const r = ok(trimCurve(bottom, P(0.1, 0.2), [left, right]))
    const [a] = r.pieces as Extract<CurveShape, { kind: 'line' }>[]
    expectPoint(a.a, 0.2, 0.2)
    expectPoint(a.b, 10, 0.2)
  })

  it('says so when nothing crosses', () => {
    expect(trimCurve(line('1', 0, 0, 10, 0), P(5, 0), [seg(20, -1, 20, 1)])).toMatch(/cutting edge/)
  })

  it('turns a circle cut twice into the arc that was not picked', () => {
    const c: CircleEntity = { ...props, handle: '2', kind: 'circle', c: P(0, 0), r: 5 }
    const r = ok(trimCurve(c, P(5, 0), [seg(0, -10, 0, 10)]))
    const [arc] = r.pieces as Extract<CurveShape, { kind: 'arc' }>[]
    // Cut at 90° and 270°; the right half (around 0°) goes, the left half stays.
    expect(arc.start).toBeCloseTo(Math.PI / 2, 12)
    expect(arc.end).toBeCloseTo((3 * Math.PI) / 2, 12)
  })

  it('trims an arc at a crossing line', () => {
    const a: ArcEntity = {
      ...props,
      handle: '3',
      kind: 'arc',
      c: P(0, 0),
      r: 5,
      start: 0,
      end: Math.PI,
    }
    const r = ok(trimCurve(a, P(4, 3), [seg(0, -10, 0, 10)]))
    const [arc] = r.pieces as Extract<CurveShape, { kind: 'arc' }>[]
    expect(arc.start).toBeCloseTo(Math.PI / 2, 12)
    expect(arc.end).toBeCloseTo(Math.PI, 12)
  })

  it('opens a closed polyline, keeping the run that was not picked', () => {
    const rect: PolylineEntity = {
      ...props,
      handle: '4',
      kind: 'polyline',
      vertices: [P(0, 0), P(10, 0), P(10, 8), P(0, 8)].map((p) => ({ ...p, bulge: 0 })),
      closed: true,
      width: 0,
    }
    const r = ok(trimCurve(rect, P(5, 0), [seg(3, -1, 3, 9), seg(7, -1, 7, 9)]))
    const [pl] = r.pieces as PolylineEntity[]
    expect(pl.closed).toBe(false)
    // Only the piece between the cuts either side of the pick goes: the top edge,
    // crossed by the same edges, stays whole.
    const want = [P(7, 0), P(10, 0), P(10, 8), P(0, 8), P(0, 0), P(3, 0)]
    expect(pl.vertices).toHaveLength(want.length)
    pl.vertices.forEach((v, i) => expectPoint(v, want[i].x, want[i].y))
  })
})

describe('EXTEND', () => {
  it('runs a line on to the boundary nearest its picked end', () => {
    const r = ok(
      extendCurve(line('1', 0, 0, 5, 0), P(4, 0), [seg(8, -1, 8, 1), seg(12, -1, 12, 1)])
    )
    const l = r as Extract<CurveShape, { kind: 'line' }>
    expectPoint(l.a, 0, 0)
    expectPoint(l.b, 8, 0)
  })

  it('extends the start when picked near it', () => {
    const r = ok(extendCurve(line('1', 0, 0, 5, 0), P(1, 0), [seg(-3, -1, -3, 1)])) as Extract<
      CurveShape,
      { kind: 'line' }
    >
    expectPoint(r.a, -3, 0)
    expectPoint(r.b, 5, 0)
  })

  it('needs the boundary to be crossed by the extension', () => {
    expect(extendCurve(line('1', 0, 0, 5, 0), P(4, 0), [seg(8, 1, 8, 2)])).toMatch(/boundary/)
  })

  it('extends an arc round its circle', () => {
    const a: ArcEntity = {
      ...props,
      handle: '3',
      kind: 'arc',
      c: P(0, 0),
      r: 5,
      start: 0,
      end: Math.PI / 4,
    }
    const r = ok(extendCurve(a, P(3.5, 3.6), [seg(0, 0, 0, 10)])) as Extract<
      CurveShape,
      { kind: 'arc' }
    >
    expect(r.start).toBeCloseTo(0, 12)
    expect(r.end).toBeCloseTo(Math.PI / 2, 12)
  })

  it('extends the end segment of an open polyline', () => {
    const pl: PolylineEntity = {
      ...props,
      handle: '4',
      kind: 'polyline',
      vertices: [P(0, 0), P(4, 0), P(4, 3)].map((p) => ({ ...p, bulge: 0 })),
      closed: false,
      width: 0,
    }
    const r = ok(extendCurve(pl, P(4, 2.9), [seg(-1, 6, 9, 6)])) as PolylineEntity
    expectPoint(r.vertices[2], 4, 6)
  })
})

describe('FILLET', () => {
  it('radius 0 trims crossing lines to a clean corner', () => {
    const r = ok(
      fillet(line('1', -1, 0.2, 10, 0.2), P(5, 0.2), line('2', 0.2, -1, 0.2, 8), P(0.2, 4), 0)
    )
    const a = r.first as Extract<CurveShape, { kind: 'line' }>
    const b = r.second as Extract<CurveShape, { kind: 'line' }>
    expectPoint(a.a, 10, 0.2)
    expectPoint(a.b, 0.2, 0.2)
    expectPoint(b.a, 0.2, 8)
    expectPoint(b.b, 0.2, 0.2)
    expect(r.arc).toBeUndefined()
  })

  it('radius 0 extends lines that fall short of each other', () => {
    const r = ok(fillet(line('1', 1, 0, 10, 0), P(5, 0), line('2', 0, 1, 0, 8), P(0, 4), 0))
    expectPoint((r.first as Extract<CurveShape, { kind: 'line' }>).b, 0, 0)
    expectPoint((r.second as Extract<CurveShape, { kind: 'line' }>).b, 0, 0)
  })

  it('radius 2 rounds a right-angle corner with a tangent arc', () => {
    const r = ok(fillet(line('1', 0, 0, 10, 0), P(5, 0), line('2', 0, 0, 0, 10), P(0, 5), 2))
    const a = r.first as Extract<CurveShape, { kind: 'line' }>
    const b = r.second as Extract<CurveShape, { kind: 'line' }>
    expectPoint(a.a, 10, 0)
    expectPoint(a.b, 2, 0)
    expectPoint(b.a, 0, 10)
    expectPoint(b.b, 0, 2)
    expect(r.arc).toBeDefined()
    expectPoint(r.arc!.c, 2, 2)
    expect(r.arc!.r).toBeCloseTo(2, 12)
    expect(r.arc!.start).toBeCloseTo(Math.PI, 12)
    expect(r.arc!.end).toBeCloseTo((3 * Math.PI) / 2, 12)
  })

  it('radius 1 at a 45° corner', () => {
    const r = ok(fillet(line('1', 0, 0, 10, 0), P(5, 0), line('2', 0, 0, 10, 10), P(5, 5), 1))
    // Tangent distance from the corner: r / tan(22.5°).
    const d = 1 / Math.tan(Math.PI / 8)
    expectPoint((r.first as Extract<CurveShape, { kind: 'line' }>).b, d, 0)
    expectPoint(
      (r.second as Extract<CurveShape, { kind: 'line' }>).b,
      d * Math.SQRT1_2,
      d * Math.SQRT1_2
    )
    expectPoint(r.arc!.c, d, 1)
  })

  it('refuses parallel lines and too large a radius', () => {
    expect(fillet(line('1', 0, 0, 10, 0), P(5, 0), line('2', 0, 1, 10, 1), P(5, 1), 0)).toMatch(
      /parallel/
    )
    expect(fillet(line('1', 0, 0, 1, 0), P(0.5, 0), line('2', 0, 0, 0, 1), P(0, 0.5), 5)).toMatch(
      /too large/
    )
  })

  it('fillets a line and an arc with radius 0 at their crossing', () => {
    const a: ArcEntity = {
      ...props,
      handle: '3',
      kind: 'arc',
      c: P(0, 0),
      r: 5,
      start: 0,
      end: Math.PI,
    }
    const r = ok(fillet(line('1', 3, -2, 3, 10), P(3, -1), a, P(-4, 3), 0))
    expectPoint((r.first as Extract<CurveShape, { kind: 'line' }>).b, 3, 4)
    const arc = r.second as Extract<CurveShape, { kind: 'arc' }>
    expect(arc.start).toBeCloseTo(Math.atan2(4, 3), 12)
    expect(arc.end).toBeCloseTo(Math.PI, 12)
  })

  it('fillets a line and an arc with a radius: the arc is tangent to both', () => {
    const a: ArcEntity = {
      ...props,
      handle: '3',
      kind: 'arc',
      c: P(0, 0),
      r: 5,
      start: 0,
      end: Math.PI,
    }
    // The line is kept left of the circle, the arc above: the fillet sits outside the circle.
    const r = ok(fillet(line('1', -10, 0, 10, 0), P(-8, 0), a, P(-3, 4), 1))
    const f = r.arc!
    expect(f.r).toBeCloseTo(1, 12)
    // Tangent to y = 0 from above (centre y = 1) and to the circle from outside (|c| = 5 + 1).
    expect(f.c.y).toBeCloseTo(1, 9)
    expect(Math.hypot(f.c.x, f.c.y)).toBeCloseTo(6, 9)
    expect(f.c.x).toBeCloseTo(-Math.sqrt(35), 9)
    const kept = r.first as Extract<CurveShape, { kind: 'line' }>
    expectPoint(kept.a, -10, 0)
    expectPoint(kept.b, -Math.sqrt(35), 0)
  })
})
