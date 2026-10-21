/**
 * The viewport: which part of the drawing is on screen. Screen coordinates
 * are CSS pixels from the canvas's top-left, Y down; world coordinates are
 * drawing units, Y up. The conversion happens in JavaScript doubles before
 * anything reaches the canvas, so survey coordinates (6,544,000) stay exact at
 * any zoom (canvas paths are single precision).
 */
import type { Bounds } from './model/geometry'
import type { Vec } from './geom/vec'

export const MIN_SCALE = 1e-9
export const MAX_SCALE = 1e9

export class View {
  /** World point at the centre of the canvas. */
  cx = 0
  cy = 0
  /** Pixels per drawing unit. */
  scale = 20
  width = 800
  height = 600

  toScreen(p: Vec): Vec {
    return {
      x: (p.x - this.cx) * this.scale + this.width / 2,
      y: this.height / 2 - (p.y - this.cy) * this.scale,
    }
  }

  toWorld(s: Vec): Vec {
    return {
      x: (s.x - this.width / 2) / this.scale + this.cx,
      y: (this.height / 2 - s.y) / this.scale + this.cy,
    }
  }

  /** The world box on screen, grown by `marginPx`. */
  worldBox(marginPx = 0): Bounds {
    const a = this.toWorld({ x: -marginPx, y: this.height + marginPx })
    const b = this.toWorld({ x: this.width + marginPx, y: -marginPx })
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  panBy(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.scale
    this.cy += dyPx / this.scale
  }

  /** Zoom by `factor` keeping the world point under `at` (screen) where it is. */
  zoomAt(at: Vec, factor: number): void {
    const before = this.toWorld(at)
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor))
    const after = this.toWorld(at)
    this.cx += before.x - after.x
    this.cy += before.y - after.y
  }

  /** Fit a world box, leaving `marginPx` round it. */
  fit(b: Bounds, marginPx = 24): void {
    const w = Math.max(b.maxX - b.minX, 1e-9)
    const h = Math.max(b.maxY - b.minY, 1e-9)
    const sx = (this.width - 2 * marginPx) / w
    const sy = (this.height - 2 * marginPx) / h
    let s = Math.min(sx, sy)
    if (!Number.isFinite(s) || s <= 0) s = 1
    if (b.maxX - b.minX < 1e-9 && b.maxY - b.minY < 1e-9) s = this.scale
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
    this.cx = (b.minX + b.maxX) / 2
    this.cy = (b.minY + b.maxY) / 2
  }

  snapshot(): { cx: number; cy: number; scale: number } {
    return { cx: this.cx, cy: this.cy, scale: this.scale }
  }

  restore(s: { cx: number; cy: number; scale: number }): void {
    this.cx = s.cx
    this.cy = s.cy
    this.scale = s.scale
  }
}
