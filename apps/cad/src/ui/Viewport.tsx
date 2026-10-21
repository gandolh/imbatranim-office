import { useEffect, useRef } from 'react'
import { useSystemAppearance } from '@imbatranim/ui'
import type { Editor } from '../engine/editor'
import { luminance, parseCssColor } from '../engine/render/style'
import { drawOverlay, type OverlayTheme } from './overlay'

type Props = {
  editor: Editor
  /** Keystrokes belong to the command line: give it focus back after a click. */
  onFocusCommandLine: () => void
}

/** Read the desktop's tokens off a hidden element, so the canvas follows theme and accent. */
function readTheme(probe: HTMLElement | null): OverlayTheme & { drawingForeground: number } {
  const fallback = {
    background: '#141416',
    foreground: '#f2f2ef',
    accent: '#c0263a',
    tipBackground: '#f2f2ef',
    tipText: '#17171a',
  }
  if (!probe) return { ...fallback, drawingForeground: 0xffffff }
  const style = getComputedStyle(probe)
  const tip = probe.firstElementChild ? getComputedStyle(probe.firstElementChild) : null
  const background = style.backgroundColor || fallback.background
  const theme = {
    background,
    foreground: style.color || fallback.foreground,
    accent: style.borderTopColor || fallback.accent,
    tipBackground: tip?.backgroundColor || fallback.tipBackground,
    tipText: tip?.color || fallback.tipText,
  }
  // ACI 7: white on a dark model space, black on a light one.
  const dark = luminance(parseCssColor(background, 0x141416)) < 0.5
  return { ...theme, drawingForeground: dark ? 0xffffff : 0x000000 }
}

/**
 * The drawing area: the drawing on one canvas, the cursor and everything
 * that follows it on a second one above, so moving the mouse never redraws
 * the drawing.
 */
export function Viewport({ editor, onFocusCommandLine }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLCanvasElement>(null)
  const overRef = useRef<HTMLCanvasElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const appearance = useSystemAppearance()
  const themeRef = useRef(readTheme(null))

  useEffect(() => {
    const wrap = wrapRef.current
    const main = mainRef.current
    const over = overRef.current
    if (!wrap || !main || !over) return
    const mainCtx = main.getContext('2d')
    const overCtx = over.getContext('2d')
    if (!mainCtx || !overCtx) return
    let dpr = window.devicePixelRatio || 1
    let sceneQueued = false
    let overlayQueued = false
    let frame = 0
    const draw = () => {
      frame = 0
      if (sceneQueued) {
        sceneQueued = false
        editor.cache.setForeground(themeRef.current.drawingForeground)
        editor.renderer.render(mainCtx, editor.view, {
          background: themeRef.current.background,
          dpr,
        })
      }
      if (overlayQueued) {
        overlayQueued = false
        drawOverlay(overCtx, editor, editor.overlay(), themeRef.current, dpr)
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    const resize = () => {
      const r = wrap.getBoundingClientRect()
      dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.floor(r.width))
      const h = Math.max(1, Math.floor(r.height))
      for (const c of [main, over]) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
        c.style.width = `${w}px`
        c.style.height = `${h}px`
      }
      editor.resize(w, h)
      sceneQueued = overlayQueued = true
      schedule()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    const unsubscribe = editor.subscribe((c) => {
      if (c === 'scene') sceneQueued = true
      if (c === 'scene' || c === 'overlay') {
        overlayQueued = true
        schedule()
      }
    })

    const local = (e: PointerEvent | WheelEvent) => {
      const r = over.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onMove = (e: PointerEvent) => editor.pointerMove(local(e), e.buttons)
    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      over.setPointerCapture(e.pointerId)
      editor.pointerDown(local(e), e.button, { shift: e.shiftKey })
      onFocusCommandLine()
    }
    const onUp = (e: PointerEvent) => {
      if (over.hasPointerCapture(e.pointerId)) over.releasePointerCapture(e.pointerId)
      editor.pointerUp(local(e), e.button)
    }
    const onLeave = () => editor.pointerLeave()
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      editor.wheel(local(e), e.deltaY)
    }
    const onContext = (e: Event) => e.preventDefault()
    // Double middle click: zoom extents, as AutoCAD does.
    let lastMiddle = 0
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return
      const now = performance.now()
      if (now - lastMiddle < 350) editor.zoomExtents()
      lastMiddle = now
    }
    over.addEventListener('pointermove', onMove)
    over.addEventListener('pointerdown', onDown)
    over.addEventListener('pointerup', onUp)
    over.addEventListener('pointerleave', onLeave)
    over.addEventListener('wheel', onWheel, { passive: false })
    over.addEventListener('contextmenu', onContext)
    over.addEventListener('auxclick', onAux)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      unsubscribe()
      over.removeEventListener('pointermove', onMove)
      over.removeEventListener('pointerdown', onDown)
      over.removeEventListener('pointerup', onUp)
      over.removeEventListener('pointerleave', onLeave)
      over.removeEventListener('wheel', onWheel)
      over.removeEventListener('contextmenu', onContext)
      over.removeEventListener('auxclick', onAux)
    }
  }, [editor, onFocusCommandLine])

  // Theme or accent changed: re-read the tokens and redraw everything.
  useEffect(() => {
    themeRef.current = readTheme(probeRef.current)
    editor.cache.setForeground(themeRef.current.drawingForeground)
    editor.panBy(0, 0)
  }, [editor, appearance.theme, appearance.accent])

  return (
    <div
      ref={wrapRef}
      className="bg-surface-container-lowest relative min-h-0 min-w-0 flex-1 overflow-hidden"
      data-testid="cad-viewport"
    >
      <canvas ref={mainRef} className="absolute inset-0" aria-hidden="true" />
      <canvas
        ref={overRef}
        className="absolute inset-0 cursor-none touch-none"
        role="img"
        aria-label="Drawing area. Type commands and coordinates in the command line."
      />
      <div
        ref={probeRef}
        aria-hidden="true"
        className="bg-surface-container-lowest text-on-surface border-primary pointer-events-none absolute h-0 w-0 overflow-hidden border-t"
      >
        <div className="bg-inverse-surface text-inverse-on-surface" />
      </div>
    </div>
  )
}
