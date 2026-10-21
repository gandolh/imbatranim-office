/**
 * Zoom for the slide stage, from the OS's built-in Slides viewer
 * (imbatranimOS 56e23b7, apps/add-ons/slides/src/lib/zoom.ts, same licence).
 *
 * Applied as a CSS `transform: scale()` on a slide drawn at its logical
 * width, never by redrawing at another size, so text wraps the same way at
 * every zoom and in the thumbnails. 100% is the logical width (960 px).
 */

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export type ZoomMode = 'fit-width' | 'fit-page' | 'fixed'

export type Zoom = { mode: ZoomMode; scale: number }

export const DEFAULT_ZOOM: Zoom = { mode: 'fit-width', scale: 1 }

const MIN_SCALE = 0.1
const MAX_SCALE = 4

function clamp(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n))
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/**
 * The scale to apply, given the rendered slide box and the viewport.
 *
 * `fixed` uses the stored scale verbatim. The fitted modes divide, which means
 * guarding every degenerate input: a viewport or slide of zero size happens
 * genuinely (before first layout, or a window dragged to nothing) and `0/0` is
 * `NaN`, which CSS drops silently — leaving the deck at whatever scale it had.
 */
export function resolveScale(
  zoom: Zoom,
  slide: { width: number; height: number },
  viewport: { width: number; height: number }
): number {
  if (zoom.mode === 'fixed') return clamp(zoom.scale)
  if (!isPositive(slide.width) || !isPositive(slide.height)) return 1
  if (!isPositive(viewport.width) || !isPositive(viewport.height)) return 1

  if (zoom.mode === 'fit-width') return clamp(viewport.width / slide.width)
  // fit-page: the whole slide has to be visible, so the smaller ratio wins.
  return clamp(Math.min(viewport.width / slide.width, viewport.height / slide.height))
}

/** Next / previous fixed step from wherever the current scale sits. */
export function stepZoom(current: number, direction: 1 | -1): Zoom {
  const steps = ZOOM_STEPS as readonly number[]
  if (direction === 1) {
    const next = steps.find((s) => s > current + 1e-6)
    return { mode: 'fixed', scale: next ?? steps[steps.length - 1] }
  }
  const prev = [...steps].reverse().find((s) => s < current - 1e-6)
  return { mode: 'fixed', scale: prev ?? steps[0] }
}

/** Human label for the toolbar. */
export function zoomLabel(zoom: Zoom, resolved: number): string {
  if (zoom.mode === 'fit-width') return 'Fit width'
  if (zoom.mode === 'fit-page') return 'Fit page'
  return `${Math.round(resolved * 100)}%`
}
