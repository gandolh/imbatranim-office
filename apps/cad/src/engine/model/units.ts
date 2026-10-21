/**
 * Drawing units. Coordinates are plain numbers ("drawing units"); the unit
 * system only decides how a distance is shown and how a typed one is read:
 *
 * - decimal: unitless, `12.5000`
 * - architectural: one unit is an inch, shown as feet and inches to 1/16",
 *   `5'-6 1/2"`, and typed as `5'6-1/2"`, `5'6.5`, `66.5` or `6"`
 * - metric: one unit is a millimetre, centimetre or metre, `1250 mm`; a typed
 *   value may carry its own suffix (`1.2m` in a millimetre drawing is 1200)
 */
import type { MetricUnit, Units } from './types'

const METRIC_IN_MM: Record<MetricUnit, number> = { mm: 1, cm: 10, m: 1000 }

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Feet and inches to the nearest 1/16". */
export function formatArchitectural(inches: number): string {
  const sign = inches < 0 ? '-' : ''
  let sixteenths = Math.round(Math.abs(inches) * 16)
  const feet = Math.floor(sixteenths / (12 * 16))
  sixteenths -= feet * 12 * 16
  const whole = Math.floor(sixteenths / 16)
  const frac = sixteenths - whole * 16
  let fracText = ''
  if (frac > 0) {
    const g = gcd(frac, 16)
    fracText = ` ${frac / g}/${16 / g}`
  }
  const inchText = `${whole}${fracText}"`
  return feet > 0 ? `${sign}${feet}'-${inchText}` : `${sign}${inchText}`
}

/** A distance as the unit system shows it. */
export function formatDistance(value: number, units: Units): string {
  if (!Number.isFinite(value)) return String(value)
  if (units.system === 'architectural') return formatArchitectural(value)
  const text = value.toFixed(units.precision)
  return units.system === 'metric' ? `${trimZeros(text)} ${units.metricUnit}` : text
}

/** A coordinate pair, `x, y`. */
export function formatPoint(p: { x: number; y: number }, units: Units): string {
  if (units.system === 'decimal')
    return `${p.x.toFixed(units.precision)}, ${p.y.toFixed(units.precision)}`
  return `${formatDistance(p.x, units)}, ${formatDistance(p.y, units)}`
}

export function formatAngle(radians: number): string {
  let deg = (radians * 180) / Math.PI
  deg = ((deg % 360) + 360) % 360
  return `${trimZeros(deg.toFixed(2))}°`
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

function parseNumber(text: string): number | null {
  const t = text.trim()
  return NUMBER.test(t) ? Number(t) : null
}

/** `1/2`, `3`, `1.5`, `1-1/2` (one and a half) → number. */
function parseInches(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  const mixed = /^(\d+)[- ](\d+)\/(\d+)$/.exec(t)
  if (mixed) {
    const den = Number(mixed[3])
    return den === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / den
  }
  const frac = /^(\d+)\/(\d+)$/.exec(t)
  if (frac) {
    const den = Number(frac[2])
    return den === 0 ? null : Number(frac[1]) / den
  }
  return parseNumber(t)
}

/** `5'6-1/2"`, `5'-6"`, `5'`, `6"`, `66.5` → inches. */
export function parseArchitectural(text: string): number | null {
  let t = text.trim()
  let sign = 1
  if (t.startsWith('-')) {
    sign = -1
    t = t.slice(1).trim()
  } else if (t.startsWith('+')) t = t.slice(1).trim()
  const feetAt = t.indexOf("'")
  let feet = 0
  if (feetAt >= 0) {
    const f = parseNumber(t.slice(0, feetAt))
    if (f === null) return null
    feet = f
    t = t.slice(feetAt + 1).trim()
    if (t.startsWith('-')) t = t.slice(1).trim()
  }
  if (t.endsWith('"')) t = t.slice(0, -1).trim()
  const inches = parseInches(t)
  if (inches === null) return null
  return sign * (feet * 12 + inches)
}

/** A typed distance in drawing units, or null when it is not one. */
export function parseDistance(text: string, units: Units): number | null {
  const t = text.trim()
  if (t === '') return null
  if (units.system === 'architectural') return parseArchitectural(t)
  if (units.system === 'metric') {
    const m = /^(.*?)(mm|cm|m)$/i.exec(t)
    if (m) {
      const n = parseNumber(m[1])
      if (n === null) return null
      const suffix = m[2].toLowerCase() as MetricUnit
      return (n * METRIC_IN_MM[suffix]) / METRIC_IN_MM[units.metricUnit]
    }
  }
  return parseNumber(t)
}

/** A typed angle in degrees (`45`, `-30`, `45d`) → radians. */
export function parseAngle(text: string): number | null {
  const t = text.trim().replace(/[d°]$/i, '')
  const n = parseNumber(t)
  return n === null ? null : (n * Math.PI) / 180
}

/** DXF header values for a unit system: $INSUNITS and $LUNITS. */
export function unitsToHeader(units: Units): { insunits: number; lunits: number; luprec: number } {
  if (units.system === 'architectural') return { insunits: 1, lunits: 4, luprec: 4 }
  if (units.system === 'metric') {
    const insunits = units.metricUnit === 'mm' ? 4 : units.metricUnit === 'cm' ? 5 : 6
    return { insunits, lunits: 2, luprec: units.precision }
  }
  return { insunits: 0, lunits: 2, luprec: units.precision }
}

/** The unit system a file's header describes. */
export function unitsFromHeader(
  insunits: number | undefined,
  lunits: number | undefined,
  luprec: number | undefined
): Units {
  const precision = luprec !== undefined && luprec >= 0 && luprec <= 8 ? luprec : 4
  if (lunits === 4 || lunits === 5) return { system: 'architectural', precision, metricUnit: 'mm' }
  if (insunits === 4) return { system: 'metric', precision, metricUnit: 'mm' }
  if (insunits === 5) return { system: 'metric', precision, metricUnit: 'cm' }
  if (insunits === 6) return { system: 'metric', precision, metricUnit: 'm' }
  return { system: 'decimal', precision, metricUnit: 'mm' }
}
