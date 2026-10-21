/** PowerPoint's font size list, and stepping through it (Ctrl+] / Ctrl+[). */
export const FONT_SIZES = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96,
]

export function stepSize(current: number, direction: 1 | -1): number {
  if (direction > 0) return FONT_SIZES.find((s) => s > current + 0.01) ?? Math.round(current + 10)
  return (
    [...FONT_SIZES].reverse().find((s) => s < current - 0.01) ??
    Math.max(1, Math.round(current - 1))
  )
}
