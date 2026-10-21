/**
 * Typed point entry, as AutoCAD's command line takes it:
 *
 * - `x,y`         absolute (a third value, z, is accepted and dropped)
 * - `@dx,dy`      relative to the last point
 * - `@d<a`        relative polar: distance and angle in degrees, CCW from +X
 * - `d<a`         absolute polar, from the origin
 * - `@`           the last point itself
 * - `#x,y`, `*x,y` absolute (there is no UCS, so these equal `x,y`)
 * - `d`           a bare distance: direct distance entry along the cursor
 *
 * Each value is read in the drawing's units (`5'6"` in architectural).
 */
import { polar, type Vec } from '../geom/vec'
import { parseAngle, parseDistance } from '../model/units'
import type { Units } from '../model/types'

export type TypedPoint =
  | { kind: 'point'; p: Vec }
  /** A distance with no direction: the caller applies it along the cursor from the base point. */
  | { kind: 'direct'; distance: number }

export function parsePointInput(text: string, units: Units, last: Vec | null): TypedPoint | null {
  let t = text.trim().replace(/\s+/g, '')
  if (t === '') return null
  let relative = false
  if (t.startsWith('@')) {
    relative = true
    t = t.slice(1)
    if (t.startsWith('*')) t = t.slice(1)
    if (t === '') return last ? { kind: 'point', p: last } : null
  } else if (t.startsWith('#') || t.startsWith('*')) {
    t = t.slice(1)
    if (t.startsWith('@')) {
      relative = true
      t = t.slice(1)
    }
  }
  const base = relative ? last : { x: 0, y: 0 }
  if (relative && !base) return null
  if (t.includes('<')) {
    const [dText, aText] = t.split('<')
    const d = parseDistance(dText, units)
    const a = parseAngle(aText)
    if (d === null || a === null) return null
    return { kind: 'point', p: polar(base!, d, a) }
  }
  if (t.includes(',')) {
    const parts = t.split(',')
    if (parts.length < 2 || parts.length > 3) return null
    const x = parseDistance(parts[0], units)
    const y = parseDistance(parts[1], units)
    if (x === null || y === null) return null
    if (parts.length === 3 && parseDistance(parts[2], units) === null) return null
    return { kind: 'point', p: { x: base!.x + x, y: base!.y + y } }
  }
  if (relative) return null
  const d = parseDistance(t, units)
  return d === null ? null : { kind: 'direct', distance: d }
}
