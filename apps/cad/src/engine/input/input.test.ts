import { describe, expect, it } from 'vitest'
import type { Seg } from '../geom/seg'
import { DEFAULT_UNITS, type Units } from '../model/types'
import { parsePointInput } from './coords'
import { findSnap, orthoPoint, polarPoint, SNAP_MODES, type SnapMode } from './snap'

const P = (x: number, y: number) => ({ x, y })
const L = (ax: number, ay: number, bx: number, by: number): Seg => ({
  kind: 'line',
  a: P(ax, ay),
  b: P(bx, by),
})
const all = new Set<SnapMode>(SNAP_MODES)
const only = (...m: SnapMode[]) => new Set<SnapMode>(m)

describe('typed coordinates', () => {
  const u = DEFAULT_UNITS
  it('reads absolute, relative and polar points', () => {
    expect(parsePointInput('3,4', u, null)).toEqual({ kind: 'point', p: P(3, 4) })
    expect(parsePointInput(' 3 , 4 , 9 ', u, null)).toEqual({ kind: 'point', p: P(3, 4) })
    expect(parsePointInput('@4,0', u, P(1, 1))).toEqual({ kind: 'point', p: P(5, 1) })
    const polar = parsePointInput('@3<90', u, P(4, 0))
    expect(polar?.kind).toBe('point')
    if (polar?.kind === 'point') {
      expect(polar.p.x).toBeCloseTo(4, 12)
      expect(polar.p.y).toBeCloseTo(3, 12)
    }
    const abs = parsePointInput('10<45', u, P(100, 100))
    if (abs?.kind === 'point') expect(abs.p.x).toBeCloseTo(10 * Math.SQRT1_2, 12)
    expect(parsePointInput('@', u, P(2, 2))).toEqual({ kind: 'point', p: P(2, 2) })
    expect(parsePointInput('#1,2', u, P(9, 9))).toEqual({ kind: 'point', p: P(1, 2) })
  })

  it('reads a bare number as direct distance entry', () => {
    expect(parsePointInput('12.5', u, null)).toEqual({ kind: 'direct', distance: 12.5 })
  })

  it('refuses what is not a point', () => {
    expect(parsePointInput('abc', u, null)).toBeNull()
    expect(parsePointInput('@1,2', u, null)).toBeNull()
    expect(parsePointInput('1,2,3,4', u, null)).toBeNull()
  })

  it('reads feet and inches in an architectural drawing', () => {
    const arch: Units = { system: 'architectural', precision: 4, metricUnit: 'mm' }
    expect(parsePointInput(`5'6",10'`, arch, null)).toEqual({ kind: 'point', p: P(66, 120) })
    expect(parsePointInput(`@1'6-1/2"<0`, arch, P(0, 0))).toEqual({ kind: 'point', p: P(18.5, 0) })
  })

  it('reads unit suffixes in a metric drawing', () => {
    const mm: Units = { system: 'metric', precision: 2, metricUnit: 'mm' }
    expect(parsePointInput('1.2m,30cm', mm, null)).toEqual({ kind: 'point', p: P(1200, 300) })
  })
})

describe('object snaps', () => {
  const segs = [L(0, 0, 10, 0), L(5, -5, 5, 5)]

  it('endpoint wins near a line end', () => {
    expect(findSnap({ segs, cursor: P(9.6, 0.3), aperture: 0.5, modes: all })).toEqual({
      mode: 'endpoint',
      point: P(10, 0),
    })
  })

  it('midpoint near the middle of a line', () => {
    expect(
      findSnap({ segs: [L(0, 0, 10, 0)], cursor: P(5.2, 0.1), aperture: 0.5, modes: all })
    ).toEqual({ mode: 'midpoint', point: P(5, 0) })
  })

  it('intersection where two lines cross', () => {
    // (5,0) is also both lines' midpoint; with midpoint off it is the crossing that snaps.
    const hit = findSnap({
      segs,
      cursor: P(5.3, 0.2),
      aperture: 0.5,
      modes: only('intersection', 'nearest'),
    })
    expect(hit?.mode).toBe('intersection')
    expect(hit?.point.x).toBeCloseTo(5, 12)
    expect(hit?.point.y).toBeCloseTo(0, 12)
  })

  it('center while resting on a circle, marker at its centre', () => {
    const circle: Seg = { kind: 'circle', c: P(20, 20), r: 3 }
    expect(findSnap({ segs: [circle], cursor: P(23.1, 20), aperture: 0.5, modes: all })).toEqual({
      mode: 'center',
      point: P(20, 20),
    })
  })

  it('perpendicular from the base point', () => {
    const hit = findSnap({
      segs: [L(0, 0, 10, 0)],
      cursor: P(3.7, 0.2),
      aperture: 0.5,
      modes: only('perpendicular', 'nearest'),
      base: P(3, 6),
    })
    expect(hit).toEqual({ mode: 'perpendicular', point: P(3, 0) })
  })

  it('nearest only when nothing better is in reach', () => {
    const hit = findSnap({ segs: [L(0, 0, 10, 0)], cursor: P(2.2, 0.3), aperture: 0.5, modes: all })
    expect(hit?.mode).toBe('nearest')
    expect(hit?.point.x).toBeCloseTo(2.2, 12)
    expect(hit?.point.y).toBeCloseTo(0, 12)
  })

  it('a corner beats nearest even when nearest is closer to the cursor', () => {
    const hit = findSnap({
      segs: [L(0, 0, 10, 0)],
      cursor: P(9.6, 0.01),
      aperture: 0.5,
      modes: all,
    })
    expect(hit).toEqual({ mode: 'endpoint', point: P(10, 0) })
  })

  it('nothing outside the aperture, and nothing for modes that are off', () => {
    expect(findSnap({ segs, cursor: P(20, 20), aperture: 0.5, modes: all })).toBeNull()
    expect(findSnap({ segs, cursor: P(9.8, 0), aperture: 0.5, modes: only('center') })).toBeNull()
  })
})

describe('ortho and polar', () => {
  it('ortho keeps the larger axis', () => {
    expect(orthoPoint(P(0, 0), P(5, 1))).toEqual(P(5, 0))
    expect(orthoPoint(P(0, 0), P(1, -5))).toEqual(P(0, -5))
  })

  it('polar locks onto the nearest increment ray within tolerance', () => {
    const hit = polarPoint(P(0, 0), P(10, 10.2), Math.PI / 4, 0.5)
    expect(hit?.angle).toBeCloseTo(Math.PI / 4, 12)
    expect(hit?.point.x).toBeCloseTo(10.1, 9)
    expect(hit?.point.y).toBeCloseTo(10.1, 9)
    expect(polarPoint(P(0, 0), P(10, 4), Math.PI / 4, 0.5)).toBeNull()
  })
})
