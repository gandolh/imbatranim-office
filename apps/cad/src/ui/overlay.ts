/**
 * The overlay canvas: everything that moves with the pointer, drawn over the
 * drawing without redrawing it. Crosshair and pick box, rubber band and
 * previews, selection highlight, grips, the selection window, snap markers
 * and the tracking readout.
 */
import type { Seg } from '../engine/geom/seg'
import type { Vec } from '../engine/geom/vec'
import { GRIP_SIZE, PICKBOX, type Editor, type OverlayModel } from '../engine/editor'
import type { SnapMode } from '../engine/input/snap'
import { traceItem } from '../engine/render/renderer'
import type { View } from '../engine/view'

export type OverlayTheme = {
  background: string
  /** Cursor, rubber band and previews. */
  foreground: string
  accent: string
  /** Tooltip box and text. */
  tipBackground: string
  tipText: string
}

const MARKER = 6

function traceSegs(ctx: CanvasRenderingContext2D, view: View, segs: readonly Seg[]) {
  for (const seg of segs)
    traceItem(ctx, view, {
      t: 'seg',
      seg,
      style: { rgb: 0, linetype: null, linetypeScale: 1, key: '' },
    })
}

function marker(ctx: CanvasRenderingContext2D, mode: SnapMode, p: Vec) {
  const m = MARKER
  ctx.beginPath()
  switch (mode) {
    case 'endpoint':
      ctx.rect(p.x - m, p.y - m, 2 * m, 2 * m)
      break
    case 'midpoint':
      ctx.moveTo(p.x, p.y - m)
      ctx.lineTo(p.x + m, p.y + m)
      ctx.lineTo(p.x - m, p.y + m)
      ctx.closePath()
      break
    case 'center':
      ctx.arc(p.x, p.y, m, 0, Math.PI * 2)
      break
    case 'intersection':
      ctx.moveTo(p.x - m, p.y - m)
      ctx.lineTo(p.x + m, p.y + m)
      ctx.moveTo(p.x + m, p.y - m)
      ctx.lineTo(p.x - m, p.y + m)
      break
    case 'perpendicular':
      ctx.moveTo(p.x - m, p.y - m)
      ctx.lineTo(p.x - m, p.y + m)
      ctx.lineTo(p.x + m, p.y + m)
      ctx.moveTo(p.x - m, p.y)
      ctx.lineTo(p.x, p.y)
      ctx.lineTo(p.x, p.y + m)
      break
    case 'nearest':
      ctx.moveTo(p.x - m, p.y - m)
      ctx.lineTo(p.x + m, p.y - m)
      ctx.lineTo(p.x - m, p.y + m)
      ctx.lineTo(p.x + m, p.y + m)
      ctx.closePath()
      break
  }
  ctx.stroke()
}

/** A ray from `base` at `angle`, across the whole view. */
function ray(ctx: CanvasRenderingContext2D, view: View, base: Vec, angle: number) {
  const far = (view.width + view.height) / view.scale
  const a = view.toScreen(base)
  const b = view.toScreen({ x: base.x + Math.cos(angle) * far, y: base.y + Math.sin(angle) * far })
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  editor: Editor,
  model: OverlayModel,
  theme: OverlayTheme,
  dpr: number
): void {
  const view = editor.view
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, view.width, view.height)
  ctx.lineWidth = 1

  // Selection and hover highlight: the object's own geometry, dashed in the accent.
  const highlight = model.highlight.slice(0, 2000)
  if (highlight.length > 0) {
    ctx.strokeStyle = theme.accent
    ctx.setLineDash([5, 3])
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (const h of highlight) {
      const e = editor.doc.entities.get(h)
      if (e) for (const item of editor.cache.items(e)) traceItem(ctx, view, item)
    }
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (model.hover && !model.highlight.includes(model.hover)) {
    const e = editor.doc.entities.get(model.hover)
    if (e) {
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 2
      ctx.beginPath()
      for (const item of editor.cache.items(e)) traceItem(ctx, view, item)
      ctx.stroke()
    }
  }
  ctx.lineWidth = 1

  // Previews: what the command would draw if the cursor were the answer.
  if (model.preview.length > 0) {
    ctx.strokeStyle = theme.foreground
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    for (const e of model.preview)
      for (const item of editor.cache.items(e)) traceItem(ctx, view, item)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (model.previewSegs.length > 0 || model.rubber.length > 0) {
    ctx.strokeStyle = theme.foreground
    ctx.beginPath()
    traceSegs(ctx, view, model.previewSegs)
    ctx.stroke()
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    traceSegs(ctx, view, model.rubber)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Tracking paths.
  if (model.polar) {
    ctx.strokeStyle = theme.accent
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ray(ctx, view, model.polar.base, model.polar.angle)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Grips.
  for (const g of model.grips) {
    const s = view.toScreen(g.point)
    const h = GRIP_SIZE / 2
    ctx.fillStyle = g.hot ? theme.foreground : theme.accent
    ctx.fillRect(Math.round(s.x - h), Math.round(s.y - h), GRIP_SIZE, GRIP_SIZE)
    ctx.strokeStyle = theme.background
    ctx.strokeRect(
      Math.round(s.x - h) + 0.5,
      Math.round(s.y - h) + 0.5,
      GRIP_SIZE - 1,
      GRIP_SIZE - 1
    )
  }

  // Selection window: solid for a window, dashed for a crossing window.
  if (model.window) {
    const a = view.toScreen(model.window.a)
    const b = view.toScreen(model.window.b)
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(a.x - b.x)
    const h = Math.abs(a.y - b.y)
    ctx.fillStyle = theme.accent
    ctx.globalAlpha = model.window.crossing ? 0.08 : 0.14
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = 1
    ctx.strokeStyle = theme.accent
    if (model.window.crossing) ctx.setLineDash([5, 3])
    ctx.strokeRect(x + 0.5, y + 0.5, w, h)
    ctx.setLineDash([])
  }

  // Snap marker.
  if (model.snap) {
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 2
    marker(ctx, model.snap.mode, view.toScreen(model.snap.point))
    ctx.lineWidth = 1
  }

  // Crosshair and pick box.
  if (model.cursor) {
    const c = view.toScreen(model.cursor)
    const x = Math.round(c.x) + 0.5
    const y = Math.round(c.y) + 0.5
    ctx.strokeStyle = theme.foreground
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    if (model.cursorMode !== 'pickbox') {
      ctx.moveTo(0, y)
      ctx.lineTo(view.width, y)
      ctx.moveTo(x, 0)
      ctx.lineTo(x, view.height)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    if (model.cursorMode !== 'crosshair') {
      ctx.strokeStyle = theme.foreground
      ctx.strokeRect(x - PICKBOX, y - PICKBOX, PICKBOX * 2, PICKBOX * 2)
    }
    if (model.tooltip) {
      ctx.font = '11px "Space Grotesk", ui-sans-serif, system-ui, sans-serif'
      const w = ctx.measureText(model.tooltip).width + 10
      const tx = Math.min(view.width - w - 2, x + 14)
      const ty = Math.min(view.height - 20, y + 14)
      ctx.fillStyle = theme.tipBackground
      ctx.fillRect(tx, ty, w, 18)
      ctx.fillStyle = theme.tipText
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(model.tooltip, tx + 5, ty + 9)
    }
  }
}
