/**
 * Resolving an entity's look: ByLayer and ByBlock colours and linetypes, the
 * AutoCAD Color Index, and the one colour that depends on the background
 * (ACI 7 is white on a dark model space and black on paper).
 */
import ACI from 'dxf-viewer/src/parser/AutoCadColorIndex.js'
import type { CadDocument } from '../model/document'
import { BYBLOCK, BYLAYER, type Entity, type Linetype } from '../model/types'

export const hex = (rgb: number): string => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`

/** 0xRRGGBB of an ACI colour; 7 (and 0/256 when unresolved) follows `foreground`. */
export function aciRgb(index: number, foreground: number): number {
  if (index === 7 || index <= 0 || index >= 256) return foreground
  return ACI[index] ?? foreground
}

/** What an enclosing INSERT passes down to ByBlock (and layer-0) children. */
export type Inherited = { layer: string; color: number; rgb?: number; linetype: string }

export type ResolvedStyle = {
  /** 0xRRGGBB, with ACI 7 already resolved against the background. */
  rgb: number
  linetype: Linetype | null
  linetypeScale: number
}

export function resolveStyle(
  e: Entity,
  doc: CadDocument,
  foreground: number,
  inherited?: Inherited
): ResolvedStyle {
  // Block content on layer 0 takes the insert's layer, as in AutoCAD.
  const layerName = inherited && e.layer === '0' ? inherited.layer : e.layer
  const layer = doc.layer(layerName)
  let rgb: number
  if (e.rgb !== undefined) rgb = e.rgb
  else if (e.color === BYLAYER) rgb = layer.rgb ?? aciRgb(layer.color, foreground)
  else if (e.color === BYBLOCK) {
    if (inherited)
      rgb =
        inherited.rgb ??
        aciRgb(
          inherited.color === BYLAYER ? doc.layer(inherited.layer).color : inherited.color,
          foreground
        )
    else rgb = foreground
  } else rgb = aciRgb(e.color, foreground)

  let ltName = e.linetype
  if (/^bylayer$/i.test(ltName)) ltName = layer.linetype
  else if (/^byblock$/i.test(ltName))
    ltName = inherited
      ? /^bylayer$/i.test(inherited.linetype)
        ? doc.layer(inherited.layer).linetype
        : inherited.linetype
      : 'Continuous'
  return { rgb, linetype: findLinetype(doc, ltName), linetypeScale: e.linetypeScale ?? 1 }
}

export function findLinetype(doc: CadDocument, name: string): Linetype | null {
  if (/^continuous$/i.test(name)) return null
  const direct = doc.linetypes.get(name)
  if (direct) return direct.pattern.length > 0 ? direct : null
  for (const [k, lt] of doc.linetypes)
    if (k.toUpperCase() === name.toUpperCase()) return lt.pattern.length > 0 ? lt : null
  return null
}

/** Canvas dash array in pixels for a linetype at a zoom, or null for a solid line. */
export function dashFor(
  lt: Linetype | null,
  linetypeScale: number,
  pxPerUnit: number
): number[] | null {
  if (!lt) return null
  const k = linetypeScale * pxPerUnit
  const out = lt.pattern.map((d) => Math.max(Math.abs(d) * k, d === 0 ? 1 : 0.5))
  const total = out.reduce((a, b) => a + b, 0)
  // Too fine to see, or too coarse to show: draw it solid, as AutoCAD does.
  if (total < 3 || total > 1e5) return null
  return out.length % 2 === 0 ? out : [...out, ...out]
}

/** Parse a CSS colour (`rgb(…)`, `#rrggbb`) into 0xRRGGBB. */
export function parseCssColor(css: string, fallback: number): number {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css)
  if (m) return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3])
  const h = /^#([0-9a-f]{6})$/i.exec(css.trim())
  if (h) return parseInt(h[1], 16)
  return fallback
}

export function luminance(rgb: number): number {
  const r = ((rgb >> 16) & 255) / 255
  const g = ((rgb >> 8) & 255) / 255
  const b = (rgb & 255) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
