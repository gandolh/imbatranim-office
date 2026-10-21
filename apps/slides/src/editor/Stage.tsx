import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ShapeModel, SlideModel } from '../engine/model'
import type { Xfrm } from '../engine/shapes'
import { SlideView } from '../view/SlideView'
import { BASE_WIDTH, slideHeight } from '../view/slideMetrics'
import {
  HANDLES,
  insideMarquee,
  lineBetween,
  lineEnds,
  moveBy,
  resize,
  rotateTo,
  spanRect,
  type Handle,
  type Point,
} from './manipulate'
import { TextEditor, type TextEditorApi } from './TextEditor'
import type { EditParagraph } from '../engine/textEdit'

import { canEditText, selectable, type EditingState } from './selection'

type Drag =
  | {
      kind: 'move'
      start: Point
      boxes: Map<string, Xfrm>
      moved: boolean
      clickedId: string | null
      wasSelected: boolean
      client: Point
    }
  | { kind: 'resize'; id: string; handle: Handle; box: Xfrm; picture: boolean }
  | { kind: 'rotate'; id: string; box: Xfrm }
  | { kind: 'end'; id: string; end: 0 | 1; box: Xfrm }
  | { kind: 'marquee'; start: Point; now: Point; additive: string[] }

type Props = {
  model: SlideModel | null
  /** Screen pixels per logical pixel of the drawn slide. */
  scale: number
  selection: string[]
  editing: EditingState | null
  editorApi: RefObject<TextEditorApi | null>
  onSelect: (ids: string[]) => void
  onStartEdit: (id: string, caret: EditingState['caret']) => void
  onExitEdit: (id: string, paragraphs: EditParagraph[] | null) => void
  onEditorSelection: () => void
  /** A drag finished: new frames; `copy` when Ctrl was held (drop copies). */
  onCommitFrames: (frames: { id: string; box: Xfrm }[], copy: boolean) => void
  onContextMenu: (x: number, y: number, shapeId: string | null) => void
  attachViewport: (el: HTMLElement | null) => void | (() => void)
  empty?: ReactNode
}

const PAD = 24

export function Stage({
  model,
  scale,
  selection,
  editing,
  editorApi,
  onSelect,
  onStartEdit,
  onExitEdit,
  onEditorSelection,
  onCommitFrames,
  onContextMenu,
  attachViewport,
  empty,
}: Props) {
  const pageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [overrides, setOverrideState] = useState<Map<string, Xfrm> | null>(null)
  // The latest preview, for the pointerup that may arrive before React re-renders.
  const latest = useRef<Map<string, Xfrm> | null>(null)
  const setOverrides = (next: Map<string, Xfrm> | null) => {
    latest.current = next
    setOverrideState(next)
  }
  const [marquee, setMarquee] = useState<{ x: number; y: number; cx: number; cy: number } | null>(
    null
  )

  const width = BASE_WIDTH * scale
  const height = model ? slideHeight(model) * scale : 0
  /** Screen pixels per EMU. */
  const k = model ? width / model.size.cx : 1

  const shapes = useMemo(() => selectable(model), [model])
  const byId = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes])

  const toEmu = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = pageRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return { x: (clientX - rect.left) / k, y: (clientY - rect.top) / k }
    },
    [k]
  )

  const editingKey = editing ? `slide:${editing.id}` : null
  const renderEditor = useCallback(
    (shape: ShapeModel, innerScale: number) =>
      editing && shape.id === editing.id ? (
        <TextEditor
          key={editing.session}
          shape={shape}
          scale={innerScale}
          caret={editing.caret}
          apiRef={editorApi}
          onSelectionChange={onEditorSelection}
          onExit={(paragraphs) => onExitEdit(shape.id, paragraphs)}
        />
      ) : null,
    [editing, editorApi, onEditorSelection, onExitEdit]
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (!model || e.button !== 0) return
    const target = e.target as Element
    if (target.closest('[data-text-editor]')) return
    if (editing) editorApi.current?.commit()
    const p = toEmu(e.clientX, e.clientY)
    const handleEl = target.closest<HTMLElement>('[data-handle]')
    const page = e.currentTarget as HTMLElement
    const capture = () => {
      // Keeps a fast drag that leaves the page; a pointer the browser no longer tracks cannot be captured.
      try {
        page.setPointerCapture?.(e.pointerId)
      } catch {
        // Dragging still works while the pointer stays over the page.
      }
    }
    if (handleEl) {
      const id = handleEl.dataset.shape as string
      const shape = byId.get(id)
      if (!shape) return
      const h = handleEl.dataset.handle as string
      if (h === 'rotate') drag.current = { kind: 'rotate', id, box: shape.box }
      else if (h === 'end0' || h === 'end1')
        drag.current = { kind: 'end', id, end: h === 'end0' ? 0 : 1, box: shape.box }
      else
        drag.current = {
          kind: 'resize',
          id,
          handle: h as Handle,
          box: shape.box,
          picture: shape.kind === 'picture',
        }
      capture()
      e.preventDefault()
      return
    }
    const shapeEl = target.closest<HTMLElement>('[data-shape-key]')
    const key = shapeEl?.dataset.shapeKey
    const id = key && key.startsWith('slide:') ? key.slice(6) : null
    if (id && byId.has(id)) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      const wasSelected = selection.includes(id)
      let next = selection
      if (additive && !e.ctrlKey)
        next = wasSelected ? selection.filter((s) => s !== id) : [...selection, id]
      else if (!wasSelected) next = [id]
      if (next !== selection) onSelect(next)
      const boxes = new Map<string, Xfrm>()
      for (const sid of next) {
        const s = byId.get(sid)
        if (s) boxes.set(s.key, s.box)
      }
      drag.current = {
        kind: 'move',
        start: p,
        boxes,
        moved: false,
        clickedId: id,
        wasSelected: wasSelected && !additive,
        client: { x: e.clientX, y: e.clientY },
      }
      capture()
      e.preventDefault()
      return
    }
    const additive = e.shiftKey ? selection : []
    if (!e.shiftKey && selection.length) onSelect([])
    drag.current = { kind: 'marquee', start: p, now: p, additive }
    capture()
    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !model) return
    const p = toEmu(e.clientX, e.clientY)
    if (d.kind === 'move') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      if (!d.moved && Math.hypot(dx * k, dy * k) < 3) return
      d.moved = true
      const next = new Map<string, Xfrm>()
      for (const [key, box] of d.boxes) next.set(key, moveBy(box, dx, dy, e.shiftKey))
      setOverrides(next)
    } else if (d.kind === 'resize') {
      // Corners keep the proportions with Shift, and always for pictures; Ctrl grows from the centre.
      const corner = d.handle.length === 2
      const keep = corner && (d.picture || e.shiftKey)
      setOverrides(
        new Map([[`slide:${d.id}`, resize(d.box, d.handle, p, keep, e.ctrlKey || e.altKey)]])
      )
    } else if (d.kind === 'rotate') {
      setOverrides(new Map([[`slide:${d.id}`, rotateTo(d.box, p, e.shiftKey)]]))
    } else if (d.kind === 'end') {
      const ends = lineEnds(d.box)
      const other = ends[d.end === 0 ? 1 : 0]
      const box = d.end === 0 ? lineBetween(d.box, p, other) : lineBetween(d.box, other, p)
      setOverrides(new Map([[`slide:${d.id}`, box]]))
    } else {
      d.now = p
      setMarquee(spanRect(d.start, p))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || !model) return
    if (d.kind === 'marquee') {
      setMarquee(null)
      const r = spanRect(d.start, d.now)
      if (r.cx * k < 3 && r.cy * k < 3) return
      const hits = shapes.filter((s) => insideMarquee(s.box, r)).map((s) => s.id)
      onSelect([...new Set([...d.additive, ...hits])])
      return
    }
    const frames = latest.current
    setOverrides(null)
    if (d.kind === 'move' && !d.moved) {
      // A second click on a selected text shape starts editing where it landed.
      const shape = d.clickedId ? byId.get(d.clickedId) : undefined
      // An empty placeholder takes the caret at once, as PowerPoint's "Click to add …" does.
      const empty = !!shape && shape.prompt !== null && canEditText(shape)
      if (((d.wasSelected && selection.length === 1) || empty) && canEditText(shape)) {
        onStartEdit(d.clickedId as string, { x: e.clientX, y: e.clientY })
      }
      return
    }
    if (!frames) return
    const changes: { id: string; box: Xfrm }[] = []
    for (const [key, box] of frames) changes.push({ id: key.slice(6), box })
    if (changes.length) onCommitFrames(changes, d.kind === 'move' && (e.ctrlKey || e.metaKey))
  }

  /**
   * The shape under a point. Not `event.target`: after a drag the page holds
   * pointer capture, and the browser then aims click and dblclick at it.
   */
  const shapeAt = (x: number, y: number, fallback: Element): string | null => {
    const hits =
      typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(x, y)
        : [fallback]
    for (const el of hits) {
      if (el.closest('[data-text-editor]')) return null
      const key = el.closest<HTMLElement>('[data-shape-key]')?.dataset.shapeKey
      if (key?.startsWith('slide:') && pageRef.current?.contains(el)) return key.slice(6)
    }
    return null
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-text-editor]')) return
    const id = shapeAt(e.clientX, e.clientY, e.target as Element)
    if (id && canEditText(byId.get(id))) onStartEdit(id, { x: e.clientX, y: e.clientY })
  }

  const onContext = (e: React.MouseEvent) => {
    const target = e.target as Element
    if (target.closest('[data-text-editor]')) return
    e.preventDefault()
    const key = target.closest<HTMLElement>('[data-shape-key]')?.dataset.shapeKey
    const id = key?.startsWith('slide:') ? key.slice(6) : null
    if (id && !selection.includes(id)) onSelect([id])
    onContextMenu(e.clientX, e.clientY, id)
  }

  return (
    <div
      ref={attachViewport}
      className="bg-surface-container min-h-0 min-w-0 flex-1 overflow-auto"
      onPointerDown={(e) => {
        // A press on the grey around the slide clears the selection like one on the slide's background.
        if (e.target === e.currentTarget && model) {
          if (editing) editorApi.current?.commit()
          if (selection.length) onSelect([])
        }
      }}
    >
      {!model ? (
        empty
      ) : (
        <div
          className="flex min-h-full min-w-full items-center justify-center"
          style={{ padding: PAD, width: 'max-content', minWidth: '100%' }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              if (editing) editorApi.current?.commit()
              if (selection.length) onSelect([])
            }
          }}
        >
          <div
            ref={pageRef}
            role="application"
            aria-label="Slide editor"
            style={{
              position: 'relative',
              width,
              height,
              flex: 'none',
              boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
              touchAction: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null
              setOverrides(null)
              setMarquee(null)
            }}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContext}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
              }}
            >
              <SlideView
                model={model}
                showPrompts
                interactive
                overrides={overrides ?? undefined}
                editingKey={editingKey}
                renderEditor={renderEditor}
              />
            </div>
            <Overlay
              shapes={shapes.filter((s) => selection.includes(s.id))}
              overrides={overrides}
              k={k}
              editing={editing?.id ?? null}
            />
            {marquee && (
              <div
                className="border-primary bg-primary/10 pointer-events-none absolute border border-dashed"
                style={{
                  left: marquee.x * k,
                  top: marquee.y * k,
                  width: marquee.cx * k,
                  height: marquee.cy * k,
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
}

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

/** Selection frames and handles, drawn in screen pixels so they keep their size at any zoom. */
function Overlay({
  shapes,
  overrides,
  k,
  editing,
}: {
  shapes: ShapeModel[]
  overrides: Map<string, Xfrm> | null
  k: number
  editing: string | null
}) {
  return (
    <>
      {shapes.map((shape) => {
        const box = overrides?.get(shape.key) ?? shape.box
        if (shape.isLine) {
          const ends = lineEnds(box)
          return (
            <div key={shape.key}>
              {ends.map((p, i) => (
                <div
                  key={i}
                  data-handle={`end${i}`}
                  data-shape={shape.id}
                  aria-hidden="true"
                  className="border-primary bg-surface-container-lowest absolute h-[9px] w-[9px] border"
                  style={{ left: p.x * k - 4.5, top: p.y * k - 4.5, cursor: 'crosshair' }}
                />
              ))}
            </div>
          )
        }
        const w = box.cx * k
        const h = box.cy * k
        const isEditing = editing === shape.id
        return (
          <div
            key={shape.key}
            className={`outline-primary pointer-events-none absolute outline-1 ${isEditing ? 'outline-dashed' : 'outline-solid'}`}
            style={{
              left: box.x * k,
              top: box.y * k,
              width: w,
              height: h,
              transform: box.rot ? `rotate(${box.rot}deg)` : undefined,
              transformOrigin: 'center center',
            }}
          >
            {!isEditing &&
              HANDLES.map((handle) => (
                <div
                  key={handle}
                  data-handle={handle}
                  data-shape={shape.id}
                  aria-hidden="true"
                  className="border-primary bg-surface-container-lowest pointer-events-auto absolute h-[9px] w-[9px] border"
                  style={{
                    left: HANDLE_POS[handle][0] * w - 4.5,
                    top: HANDLE_POS[handle][1] * h - 4.5,
                    cursor: CURSORS[handle],
                  }}
                />
              ))}
            {!isEditing && (
              <>
                <div
                  className="bg-primary pointer-events-none absolute w-px"
                  style={{ left: w / 2, top: -18, height: 14 }}
                />
                <div
                  data-handle="rotate"
                  data-shape={shape.id}
                  aria-hidden="true"
                  className="border-primary bg-surface-container-lowest pointer-events-auto absolute h-[11px] w-[11px] border"
                  style={{ left: w / 2 - 5.5, top: -26, cursor: 'grab' }}
                />
              </>
            )}
          </div>
        )
      })}
    </>
  )
}
