/** Small shared helpers for the editor surfaces. */
import type { Color } from '@pdfcore/engine'

/** Engine {@link Color} (0–1 RGB) → a CSS `rgb()` / `rgba()` string. */
export function cssColor(c: Color, alpha = 1): string {
  const r = Math.round(clamp01(c.r) * 255)
  const g = Math.round(clamp01(c.g) * 255)
  const b = Math.round(clamp01(c.b) * 255)
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgba(${r} ${g} ${b} / ${alpha})`
}

/** `#rrggbb` → engine {@link Color}. */
export function hexToColor(hex: string): Color {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  }
}

/** Engine {@link Color} → `#rrggbb`. */
export function colorToHex(c: Color): string {
  const to = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
