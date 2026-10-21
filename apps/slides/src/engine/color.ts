/**
 * DrawingML colours: the theme's scheme, the master's colour map, and the
 * transforms (`lumMod`, `tint`, `alpha`, …) a colour element may carry.
 */
import { NS } from './ns.ts'
import type { XmlElement } from './xml.ts'

export type Rgba = { r: number; g: number; b: number; a: number }

export type ColorContext = {
  /** dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink → RRGGBB. */
  scheme: Record<string, string>
  /** bg1, tx1, bg2, tx2, … → a scheme name (the master's clrMap with overrides). */
  map: Record<string, string>
  /** The colour a style reference substitutes for `phClr`. */
  phClr?: Rgba | null
}

export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }

const PRESET: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  lime: '00FF00',
  blue: '0000FF',
  yellow: 'FFFF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  gray: '808080',
  grey: '808080',
  silver: 'C0C0C0',
  maroon: '800000',
  navy: '000080',
  olive: '808000',
  orange: 'FFA500',
  purple: '800080',
  teal: '008080',
  ltGray: 'D3D3D3',
  dkGray: 'A9A9A9',
  dkBlue: '00008B',
  dkRed: '8B0000',
  dkGreen: '006400',
}

const SYSTEM: Record<string, string> = {
  windowText: '000000',
  window: 'FFFFFF',
  btnFace: 'F0F0F0',
  btnText: '000000',
  highlight: '3399FF',
  highlightText: 'FFFFFF',
  menuText: '000000',
  grayText: '6D6D6D',
}

export function hexToRgba(hex: string, a = 1): Rgba {
  const h = /^[0-9a-fA-F]{6}$/.test(hex) ? hex : '000000'
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a,
  }
}

export function rgbaToHex(c: Rgba): string {
  const h = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase()
}

export function css(c: Rgba | null | undefined): string {
  if (!c) return 'transparent'
  const a = Math.round(Math.min(1, Math.max(0, c.a)) * 1000) / 1000
  return a >= 1
    ? `#${rgbaToHex(c).toLowerCase()}`
    : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`
}

const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const fromLinear = (c: number) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, v * 255))
}

function toHsl({ r, g, b }: Rgba): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number, a: number): Rgba {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return { r: f(hue + 1 / 3) * 255, g: f(hue) * 255, b: f(hue - 1 / 3) * 255, a }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Apply a colour element's transform children, in document order. */
function transform(base: Rgba, el: XmlElement): Rgba {
  let c = { ...base }
  for (const t of el.elements()) {
    const v = Number(t.attr('val'))
    const f = Number.isFinite(v) ? v / 100000 : 0
    switch (t.local) {
      case 'alpha':
        c.a = clamp01(f)
        break
      case 'alphaMod':
        c.a = clamp01(c.a * f)
        break
      case 'alphaOff':
        c.a = clamp01(c.a + f)
        break
      case 'tint': {
        // Toward white, in linear light.
        const mix = (x: number) => fromLinear(toLinear(x) * f + (1 - f))
        c = { r: mix(c.r), g: mix(c.g), b: mix(c.b), a: c.a }
        break
      }
      case 'shade': {
        const mix = (x: number) => fromLinear(toLinear(x) * f)
        c = { r: mix(c.r), g: mix(c.g), b: mix(c.b), a: c.a }
        break
      }
      case 'lumMod':
      case 'lumOff':
      case 'satMod':
      case 'satOff':
      case 'hueMod':
      case 'hueOff':
      case 'hue':
      case 'sat':
      case 'lum': {
        let [h, s, l] = toHsl(c)
        if (t.local === 'lumMod') l = clamp01(l * f)
        else if (t.local === 'lumOff') l = clamp01(l + f)
        else if (t.local === 'satMod') s = clamp01(s * f)
        else if (t.local === 'satOff') s = clamp01(s + f)
        else if (t.local === 'hueMod') h = h * f
        else if (t.local === 'hueOff') h = h + v / 60000
        else if (t.local === 'hue') h = v / 60000
        else if (t.local === 'sat') s = clamp01(f)
        else l = clamp01(f)
        c = fromHsl(h, s, l, c.a)
        break
      }
      case 'comp': {
        const [h, s, l] = toHsl(c)
        c = fromHsl(h + 180, s, l, c.a)
        break
      }
      case 'inv':
        c = { r: 255 - c.r, g: 255 - c.g, b: 255 - c.b, a: c.a }
        break
      case 'gray': {
        const y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
        c = { r: y, g: y, b: y, a: c.a }
        break
      }
    }
  }
  return c
}

/** A scheme name (`accent1`, `tx1`, `bg2`, `phClr`) → colour. */
export function schemeColor(name: string, ctx: ColorContext): Rgba | null {
  if (name === 'phClr') return ctx.phClr ?? null
  const mapped = ctx.map[name] ?? name
  const hex = ctx.scheme[mapped] ?? ctx.scheme[name]
  return hex ? hexToRgba(hex) : null
}

const COLOR_TAGS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'])

/** The first colour element among `el`'s children (in a solidFill, a gradient stop, …). */
export function colorChild(el: XmlElement | null): XmlElement | null {
  if (!el) return null
  return el.elements().find((c) => c.ns === NS.a && COLOR_TAGS.has(c.local)) ?? null
}

/** Resolve a colour element. */
export function resolveColor(el: XmlElement | null, ctx: ColorContext): Rgba | null {
  if (!el) return null
  let base: Rgba | null = null
  switch (el.local) {
    case 'srgbClr':
      base = hexToRgba(el.attr('val') ?? '000000')
      break
    case 'schemeClr':
      base = schemeColor(el.attr('val') ?? '', ctx)
      break
    case 'sysClr':
      base = hexToRgba(el.attr('lastClr') ?? SYSTEM[el.attr('val') ?? ''] ?? '000000')
      break
    case 'prstClr':
      base = hexToRgba(PRESET[el.attr('val') ?? ''] ?? '000000')
      break
    case 'scrgbClr': {
      const p = (k: string) => fromLinear(Number(el.attr(k) ?? 0) / 100000)
      base = { r: p('r'), g: p('g'), b: p('b'), a: 1 }
      break
    }
    case 'hslClr': {
      const h = Number(el.attr('hue') ?? 0) / 60000
      const s = Number(el.attr('sat') ?? 0) / 100000
      const l = Number(el.attr('lum') ?? 0) / 100000
      base = fromHsl(h, s, l, 1)
      break
    }
  }
  return base ? transform(base, el) : null
}

/** Read `a:clrScheme` into name → hex. */
export function readScheme(clrScheme: XmlElement | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!clrScheme) return out
  for (const slot of clrScheme.elements()) {
    const c = colorChild(slot)
    if (!c) continue
    if (c.local === 'srgbClr') out[slot.local] = (c.attr('val') ?? '000000').toUpperCase()
    else if (c.local === 'sysClr')
      out[slot.local] = (c.attr('lastClr') ?? SYSTEM[c.attr('val') ?? ''] ?? '000000').toUpperCase()
    else {
      const rgb = resolveColor(c, { scheme: {}, map: {} })
      if (rgb) out[slot.local] = rgbaToHex(rgb)
    }
  }
  return out
}

/** Read the attributes of `p:clrMap` / `a:overrideClrMapping`. */
export function readColorMap(el: XmlElement | null, base: Record<string, string> = {}) {
  const out = { ...base }
  if (!el) return out
  for (const a of el.attrs) {
    if (a.name.includes(':') || a.name === 'xmlns') continue
    out[a.name] = el.attr(a.name) as string
  }
  return out
}

export const DEFAULT_COLOR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
}
