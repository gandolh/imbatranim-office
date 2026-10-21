import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Plus, Presentation } from 'lucide-react'
import {
  Button,
  ContextMenu,
  fileName,
  reportFileFailure,
  useDocumentedShortcuts,
  useElementSize,
  useFileDialog,
  useSystem,
  useTopWindowKeydown,
  type ContextMenuItem,
} from '@imbatranim/ui'
import { readTheme, type ShapeModel } from '../engine/model'
import { INSERTABLE_SHAPES } from '../engine/geometry'
import {
  alignShapesText,
  copyShapes,
  deleteShapes,
  fillShapes,
  formatShapesText,
  insertPicture,
  insertShape,
  insertTextBox,
  outlineShapes,
  paragraphCount,
  pasteShapes,
  restackShapes,
  setShapeBox,
  writeShapeText,
  type Restack,
} from '../engine/edits'
import type { EditParagraph } from '../engine/textEdit'
import type { Xfrm } from '../engine/shapes'
import { resolveScale, stepZoom, zoomLabel, type Zoom } from '../lib/zoom'
import { SlideView } from '../view/SlideView'
import { BASE_WIDTH, slideHeight } from '../view/slideMetrics'
import { hasClip, setClip, takeClip } from './clipboard'
import { NotesPane } from './NotesPane'
import { normalizeNotes } from './notesText'
import { colorMenu } from './palette'
import { Presenter } from './Presenter'
import { Rail } from './Rail'
import { canEditText, selectable, type EditingState } from './selection'
import { Stage } from './Stage'
import type { DeckStore } from './store'
import { FONT_SIZES, stepSize } from './fontSizes'
import type { TextEditorApi } from './TextEditor'
import { Toolbar, type MenuAnchor, type ToolbarActions, type ToolbarState } from './Toolbar'

/** What the editor needs from the file shell (shell/useDeckFile). */
export type FileControls = {
  name: string
  saving: boolean
  save: () => void
  saveAs: () => void
  newDeck: () => void
  open: () => void
  download: (() => void) | null
  /** Register what must happen before any save (commit typed text and notes). */
  setBeforeSave: (fn: (() => void) | null) => void
}

type Menu = { x: number; y: number; items: ContextMenuItem[]; label: string }

const PICTURE_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'bmp']
const STAGE_PAD = 48
/** EMU per CSS pixel at 96 dpi. */
const EMU_PER_PX = 9525

function imageSize(
  bytes: Uint8Array,
  ext: string
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return Promise.resolve(null)
  const type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return createImageBitmap(new Blob([bytes as BlobPart], { type })).then(
    (bmp) => {
      const size = { width: bmp.width, height: bmp.height }
      bmp.close()
      return size
    },
    () => null
  )
}

const SHORTCUTS = [
  { id: 'slides-new-slide', keys: 'mod+m', description: 'New slide' },
  { id: 'slides-duplicate', keys: 'mod+d', description: 'Duplicate the selection' },
  { id: 'slides-undo', keys: 'mod+z', description: 'Undo' },
  { id: 'slides-redo', keys: 'mod+y', description: 'Redo' },
  { id: 'slides-bold', keys: 'mod+b', description: 'Bold' },
  { id: 'slides-italic', keys: 'mod+i', description: 'Italic' },
  { id: 'slides-underline', keys: 'mod+u', description: 'Underline' },
  { id: 'slides-center', keys: 'mod+e', description: 'Centre the text' },
  { id: 'slides-bigger', keys: 'mod+]', description: 'Increase font size' },
  { id: 'slides-smaller', keys: 'mod+[', description: 'Decrease font size' },
  { id: 'slides-present', keys: 'f5', description: 'Present from the first slide' },
  { id: 'slides-present-here', keys: 'shift+f5', description: 'Present from the current slide' },
  {
    id: 'slides-nudge',
    keys: 'arrows',
    description: 'Nudge the selection (Ctrl for a fine nudge)',
  },
  { id: 'slides-edit', keys: 'f2', description: 'Edit the selected shape’s text' },
].map((s) => ({ ...s, scope: 'Editing' as const }))

export function Editor({ store, file }: { store: DeckStore; file: FileControls }) {
  const system = useSystem()
  const version = useSyncExternalStore(store.subscribe, store.getVersion)
  const deck = store.deck
  const slides = store.slides()
  const [current, setCurrent] = useState(0)
  const index = Math.max(0, Math.min(current, slides.length - 1))
  const slidePart = slides[index]?.part ?? null
  const model = slides.length ? store.model(index) : null

  const [rawSelection, setSelection] = useState<string[]>([])
  const [editing, setEditing] = useState<(EditingState & { part: string }) | null>(null)
  const editorApi = useRef<TextEditorApi | null>(null)
  const sessions = useRef(0)
  /** The step that inserted a text box now being typed into, dropped if it is left empty. */
  const insertedBox = useRef<{ id: string; token: number } | null>(null)
  const [zoom, setZoom] = useState<Zoom>({ mode: 'fit-page', scale: 1 })
  const [viewport, attachViewport] = useElementSize()
  const [showRail, setShowRail] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [presenting, setPresenting] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [exporting, setExporting] = useState<{
    index: number
    resolve: (el: HTMLElement | null) => void
  } | null>(null)
  /** The caret's formatting while text is edited, for the toolbar toggles. */
  const [editState, setEditState] = useState<ReturnType<TextEditorApi['state']> | null>(null)
  const refreshEditState = useCallback(() => setEditState(editorApi.current?.state() ?? null), [])
  const { saveFile } = useFileDialog()

  useDocumentedShortcuts(SHORTCUTS)

  const shapes = useMemo(() => selectable(model), [model])
  const selection = useMemo(
    () => rawSelection.filter((id) => shapes.some((s) => s.id === id)),
    [rawSelection, shapes]
  )
  const selectedShapes = shapes.filter((s) => selection.includes(s.id))

  const fail = useCallback(
    (what: string, err: unknown) => {
      console.error(`slides: ${what} failed`, err)
      system.notify({
        level: 'error',
        title: `Could not ${what}`,
        body: err instanceof Error ? err.message : String(err),
      })
    },
    [system]
  )

  const act = useCallback(
    <T,>(label: string, fn: () => T): T | undefined => {
      try {
        return store.act(label, fn)
      } catch (err) {
        fail(label.toLowerCase(), err)
        return undefined
      }
    },
    [store, fail]
  )

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goTo = useCallback(
    (i: number) => {
      editorApi.current?.commit()
      setEditing(null)
      setSelection([])
      setCurrent(Math.max(0, Math.min(i, store.slides().length - 1)))
    },
    [store]
  )

  // ── Text editing ───────────────────────────────────────────────────────────

  const startEdit = useCallback(
    (id: string, caret: EditingState['caret']) => {
      if (!slidePart) return
      setSelection([id])
      setEditing({ id, caret, session: ++sessions.current, part: slidePart })
    },
    [slidePart]
  )

  const exitEdit = useCallback(
    (id: string, paragraphs: EditParagraph[] | null) => {
      setEditing((e) => (e && e.id === id ? null : e))
      const part = editing?.id === id ? editing.part : slidePart
      if (!part || !paragraphs) return
      const unchanged =
        paragraphs.every((p) => p.keep) &&
        paragraphs.length === paragraphCount(store.deck, part, id)
      const empty = paragraphs.every((p) =>
        p.runs.every((r) => !r.field && !r.br && r.text.trim() === '')
      )
      const inserted = insertedBox.current
      insertedBox.current = null
      if (empty && inserted && inserted.id === id && store.discard(inserted.token)) {
        setSelection([])
        return
      }
      if (unchanged) return
      act('Typing', () => writeShapeText(store.deck, part, id, paragraphs))
    },
    [act, editing, slidePart, store]
  )

  const commitEditing = useCallback(() => {
    editorApi.current?.commit()
  }, [])

  // Ctrl+S, the toolbar and the close dialog all save through the shell: what
  // is still being typed (slide text, notes) goes into the deck first.
  const notesFlush = useRef<(() => void) | null>(null)
  const { setBeforeSave } = file
  useEffect(() => {
    setBeforeSave(() => {
      editorApi.current?.commit()
      notesFlush.current?.()
    })
    return () => setBeforeSave(null)
  }, [setBeforeSave])

  // ── Actions ────────────────────────────────────────────────────────────────

  const layoutForNew = useCallback(
    (after: number = index): string | null => {
      const layouts = deck.layouts()
      if (layouts.length === 0) return null
      const afterPart = store.slides()[after]?.part ?? null
      const cur = afterPart ? deck.layoutOf(afterPart) : null
      const curLayout = layouts.find((l) => l.part === cur)
      // After a title slide, PowerPoint adds a Title and Content one.
      if (!curLayout || curLayout.type === 'title')
        return (layouts.find((l) => l.type === 'obj') ?? layouts[0]).part
      return curLayout.part
    },
    [deck, index, store]
  )

  const newSlide = useCallback(
    (layoutPart?: string, after: number = index) => {
      commitEditing()
      const layout = layoutPart ?? layoutForNew(after)
      if (!layout) return
      const at = slides.length ? after + 1 : 0
      if (act('New slide', () => deck.addSlide(layout, at))) goTo(at)
    },
    [act, commitEditing, deck, goTo, index, layoutForNew, slides.length]
  )

  const duplicateSlide = useCallback(
    (i = index) => {
      commitEditing()
      if (act('Duplicate slide', () => deck.duplicateSlide(i))) goTo(i + 1)
    },
    [act, commitEditing, deck, goTo, index]
  )

  const deleteSlide = useCallback(
    (i = index) => {
      commitEditing()
      setEditing(null)
      act('Delete slide', () => deck.deleteSlide(i))
      goTo(Math.min(i, store.slides().length - 1))
    },
    [act, commitEditing, deck, goTo, index, store]
  )

  const moveSlide = useCallback(
    (from: number, to: number) => {
      commitEditing()
      act('Move slide', () => deck.moveSlide(from, to))
      if (from === index) setCurrent(to)
      else if (from < index && to >= index) setCurrent(index - 1)
      else if (from > index && to <= index) setCurrent(index + 1)
    },
    [act, commitEditing, deck, index]
  )

  const centeredBox = useCallback(
    (cx: number, cy: number) => {
      const size = deck.size()
      return { x: (size.cx - cx) / 2, y: (size.cy - cy) / 2, cx, cy }
    },
    [deck]
  )

  const insertText = useCallback(() => {
    if (!slidePart) return
    commitEditing()
    const size = deck.size()
    const id = act('Insert text box', () =>
      insertTextBox(deck, slidePart, centeredBox(size.cx * 0.5, size.cy * 0.1))
    )
    if (!id) return
    insertedBox.current = { id, token: store.stateToken }
    startEdit(id, 'end')
  }, [act, centeredBox, commitEditing, deck, slidePart, startEdit, store])

  const insertPreset = useCallback(
    (preset: string) => {
      if (!slidePart) return
      commitEditing()
      const size = deck.size()
      const side = Math.min(size.cx, size.cy) * 0.3
      const box =
        preset === 'line'
          ? { ...centeredBox(side * 1.5, 0) }
          : centeredBox(side * (preset === 'rightArrow' ? 1.6 : 1), side)
      const id = act('Insert shape', () => insertShape(deck, slidePart, preset, box))
      if (id) setSelection([id])
    },
    [act, centeredBox, commitEditing, deck, slidePart]
  )

  const insertImage = useCallback(async () => {
    if (!slidePart) return
    commitEditing()
    const choice = await system.fs.pickOpen({ title: 'Insert picture', extensions: PICTURE_TYPES })
    if (!choice) return
    const ext = (choice.path.split('.').pop() ?? '').toLowerCase()
    if (!PICTURE_TYPES.includes(ext)) {
      system.notify({
        level: 'warning',
        title: 'Cannot insert this picture',
        body: `${fileName(choice.path)} — Slides inserts PNG, JPEG, GIF and BMP pictures.`,
      })
      return
    }
    try {
      const bytes = new Uint8Array(await system.fs.read(choice.root, choice.path))
      const natural = await imageSize(bytes, ext)
      const size = deck.size()
      let cx = natural ? natural.width * EMU_PER_PX : size.cx * 0.4
      let cy = natural ? natural.height * EMU_PER_PX : size.cy * 0.4
      const fit = Math.min(1, (size.cx * 0.8) / cx, (size.cy * 0.8) / cy)
      cx *= fit
      cy *= fit
      const id = act('Insert picture', () =>
        insertPicture(deck, slidePart, bytes, ext, centeredBox(cx, cy), fileName(choice.path))
      )
      if (id) setSelection([id])
    } catch (err) {
      reportFileFailure(system, 'open', err, { noun: 'picture', name: fileName(choice.path) })
    }
  }, [act, centeredBox, commitEditing, deck, slidePart, system])

  // The shape actions take explicit ids: a context menu built in the same
  // event as the right-click's selection would otherwise see the old one.
  const deleteSelection = useCallback(
    (ids: string[] = selection) => {
      if (!slidePart || ids.length === 0) return
      act(ids.length > 1 ? 'Delete shapes' : 'Delete shape', () =>
        deleteShapes(deck, slidePart, ids)
      )
      setSelection([])
    },
    [act, deck, selection, slidePart]
  )

  const commitFrames = useCallback(
    (frames: { id: string; box: Xfrm }[], copy: boolean) => {
      if (!slidePart) return
      if (copy) {
        const clip = copyShapes(
          deck,
          slidePart,
          frames.map((f) => f.id)
        )
        if (!clip) return
        const ids = act('Copy shapes', () => {
          const added = pasteShapes(deck, slidePart, clip, 0)
          added.forEach((id, i) => {
            const frame = frames[i]
            if (frame) setShapeBox(deck, slidePart, id, frame.box)
          })
          return added
        })
        if (ids) setSelection(ids)
        return
      }
      const before = new Map(shapes.map((s) => [s.id, s.box]))
      const resized = frames.some((f) => {
        const b = before.get(f.id)
        return (
          b &&
          (Math.round(b.cx) !== Math.round(f.box.cx) || Math.round(b.cy) !== Math.round(f.box.cy))
        )
      })
      const rotated = frames.some((f) => before.get(f.id)?.rot !== f.box.rot)
      act(rotated ? 'Rotate' : resized ? 'Resize' : 'Move', () => {
        for (const f of frames) setShapeBox(deck, slidePart, f.id, f.box)
      })
    },
    [act, deck, shapes, slidePart]
  )

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!slidePart || selectedShapes.length === 0) return
      act('Nudge', () => {
        for (const s of selectedShapes)
          setShapeBox(deck, slidePart, s.id, { ...s.box, x: s.box.x + dx, y: s.box.y + dy })
      })
    },
    [act, deck, selectedShapes, slidePart]
  )

  const copy = useCallback(
    (ids: string[] = selection) => {
      if (!slidePart || ids.length === 0) return false
      setClip(copyShapes(deck, slidePart, ids), slidePart)
      return true
    },
    [deck, selection, slidePart]
  )

  const paste = useCallback(() => {
    if (!slidePart) return
    const taken = takeClip(deck, slidePart)
    if (!taken) return
    const ids = act('Paste', () => pasteShapes(deck, slidePart, taken.clip, taken.offset))
    if (ids) setSelection(ids)
  }, [act, deck, slidePart])

  const duplicateShapes = useCallback(
    (ids: string[] = selection) => {
      if (!slidePart || ids.length === 0) return
      const clip = copyShapes(deck, slidePart, ids)
      if (!clip) return
      const added = act('Duplicate', () => pasteShapes(deck, slidePart, clip, 182880))
      if (added) setSelection(added)
    },
    [act, deck, selection, slidePart]
  )

  const pastePicture = useCallback(
    async (blob: Blob) => {
      if (!slidePart) return
      const ext = blob.type === 'image/jpeg' ? 'jpeg' : blob.type === 'image/gif' ? 'gif' : 'png'
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const natural = await imageSize(bytes, ext)
      const size = deck.size()
      let cx = natural ? natural.width * EMU_PER_PX : size.cx * 0.4
      let cy = natural ? natural.height * EMU_PER_PX : size.cy * 0.4
      const fit = Math.min(1, (size.cx * 0.8) / cx, (size.cy * 0.8) / cy)
      cx *= fit
      cy *= fit
      const id = act('Paste picture', () =>
        insertPicture(deck, slidePart, bytes, ext, centeredBox(cx, cy), 'Pasted picture')
      )
      if (id) setSelection([id])
    },
    [act, centeredBox, deck, slidePart]
  )

  // ── Formatting ─────────────────────────────────────────────────────────────

  const textTargets = selectedShapes.filter((s) => canEditText(s))
  const firstStyle = (shape: ShapeModel | undefined) => {
    const p =
      shape?.text?.paragraphs.find((x) => x.runs.some((r) => r.kind !== 'br')) ??
      shape?.text?.paragraphs[0]
    return p?.runs.find((r) => r.kind !== 'br')?.style ?? p?.endStyle ?? null
  }

  const toggle = useCallback(
    (what: 'bold' | 'italic' | 'underline') => {
      if (editing) {
        editorApi.current?.toggle(what)
        refreshEditState()
        return
      }
      if (!slidePart || textTargets.length === 0) return
      const style = firstStyle(textTargets[0])
      const on = !(style ? style[what] : false)
      act(what === 'bold' ? 'Bold' : what === 'italic' ? 'Italic' : 'Underline', () =>
        formatShapesText(
          deck,
          slidePart,
          textTargets.map((s) => s.id),
          { [what]: on }
        )
      )
    },
    [act, deck, editing, refreshEditState, slidePart, textTargets]
  )

  const setSize = useCallback(
    (size: number | 'up' | 'down') => {
      if (editing) {
        editorApi.current?.setSize(size)
        refreshEditState()
        return
      }
      if (!slidePart || textTargets.length === 0) return
      act('Font size', () => {
        for (const s of textTargets) {
          const cur = firstStyle(s)?.sizePt ?? 18
          const next = size === 'up' ? stepSize(cur, 1) : size === 'down' ? stepSize(cur, -1) : size
          formatShapesText(deck, slidePart, [s.id], { size: next })
        }
      })
    },
    [act, deck, editing, refreshEditState, slidePart, textTargets]
  )

  const setColor = useCallback(
    (hex: string) => {
      if (editing) {
        editorApi.current?.setColor(hex)
        return
      }
      if (!slidePart || textTargets.length === 0) return
      act('Font colour', () =>
        formatShapesText(
          deck,
          slidePart,
          textTargets.map((s) => s.id),
          { color: hex }
        )
      )
    },
    [act, deck, editing, slidePart, textTargets]
  )

  const align = useCallback(
    (a: 'l' | 'ctr' | 'r' | 'just') => {
      if (editing) {
        editorApi.current?.align(a)
        return
      }
      if (!slidePart || textTargets.length === 0) return
      act('Align', () =>
        alignShapesText(
          deck,
          slidePart,
          textTargets.map((s) => s.id),
          a
        )
      )
    },
    [act, deck, editing, slidePart, textTargets]
  )

  const restack = useCallback(
    (how: Restack, ids: string[] = selection) => {
      if (!slidePart || ids.length === 0) return
      act(
        how === 'front'
          ? 'Bring to front'
          : how === 'back'
            ? 'Send to back'
            : how === 'forward'
              ? 'Bring forward'
              : 'Send backward',
        () => restackShapes(deck, slidePart, ids, how)
      )
    },
    [act, deck, selection, slidePart]
  )

  const scheme = useMemo(() => {
    void version
    const master = slidePart ? deck.masterOf(deck.layoutOf(slidePart) ?? '') : deck.masters()[0]
    const theme = master ? deck.themeOf(master) : null
    return readTheme(theme ? deck.pkg.root(theme) : null).scheme
  }, [deck, slidePart, version])

  // ── Undo ───────────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    commitEditing()
    store.undo()
  }, [commitEditing, store])
  const redo = useCallback(() => {
    commitEditing()
    store.redo()
  }, [commitEditing, store])

  // ── Menus ──────────────────────────────────────────────────────────────────

  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = (at: MenuAnchor, label: string, items: ContextMenuItem[]) =>
    setMenu({ x: at.x, y: at.y, label, items })

  const layoutItems = (): ContextMenuItem[] =>
    deck.layouts().map((l) => ({ label: l.name, onSelect: () => newSlide(l.part) }))

  const slideMenu = (x: number, y: number, i: number) =>
    openMenu({ x, y }, 'Slide', [
      { label: 'New slide', onSelect: () => newSlide(undefined, i) },
      { label: 'Duplicate slide', onSelect: () => duplicateSlide(i) },
      { label: 'Delete slide', danger: true, onSelect: () => deleteSlide(i) },
      { type: 'separator' },
      { label: 'Move up', disabled: i === 0, onSelect: () => moveSlide(i, i - 1) },
      { label: 'Move down', disabled: i >= slides.length - 1, onSelect: () => moveSlide(i, i + 1) },
    ])

  const stageMenu = (x: number, y: number, shapeId: string | null) => {
    if (shapeId) {
      const shape = shapes.find((s) => s.id === shapeId)
      const ids = selection.includes(shapeId) ? selection : [shapeId]
      openMenu({ x, y }, 'Shape', [
        { label: 'Cut', onSelect: () => copy(ids) && deleteSelection(ids) },
        { label: 'Copy', onSelect: () => void copy(ids) },
        { label: 'Paste', disabled: !hasClip(), onSelect: paste },
        { label: 'Duplicate', onSelect: () => duplicateShapes(ids) },
        { type: 'separator' },
        ...(canEditText(shape)
          ? [{ label: 'Edit text', onSelect: () => startEdit(shapeId, 'end') } as ContextMenuItem]
          : []),
        { label: 'Bring to front', onSelect: () => restack('front', ids) },
        { label: 'Send to back', onSelect: () => restack('back', ids) },
        { type: 'separator' },
        { label: 'Delete', danger: true, onSelect: () => deleteSelection(ids) },
      ])
      return
    }
    openMenu({ x, y }, 'Slide', [
      { label: 'Paste', disabled: !hasClip(), onSelect: paste },
      { type: 'separator' },
      { label: 'New slide', onSelect: () => newSlide() },
      { label: 'Duplicate slide', onSelect: () => duplicateSlide() },
      { label: 'Delete slide', danger: true, onSelect: () => deleteSlide() },
    ])
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  const exportRef = useRef<HTMLDivElement | null>(null)
  const exportPng = useCallback(async () => {
    if (!model || exporting) return
    const docName = file.name.replace(/\.(pptx|pptm|ppsx|potx)$/i, '')
    const suggested = `${docName}-slide-${index + 1}.png`
    const choice = await saveFile({
      title: 'Export slide as PNG',
      suggestedName: suggested,
      extensions: ['png'],
    })
    if (!choice) return
    const el = await new Promise<HTMLElement | null>((resolve) => setExporting({ index, resolve }))
    try {
      if (!el) throw new Error('The slide could not be drawn.')
      // Dynamically imported: it stays out of the app's entry chunk.
      const { toBlob } = await import('html-to-image')
      const blob = await toBlob(el, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        skipFonts: true,
        cacheBust: false,
      })
      if (!blob) throw new Error('The slide could not be rasterized.')
      const name = fileName(choice.path, suggested)
      await system.fs.upload(choice.root, choice.path, await blob.arrayBuffer(), name)
      system.notify({
        level: 'success',
        title: 'Slide exported',
        body: `${name} — saved to /${choice.path.split('/').slice(0, -1).join('/') || 'home'}`,
      })
    } catch (err) {
      reportFileFailure(system, 'save', err, { noun: 'slide image', name: file.name })
    } finally {
      setExporting(null)
    }
  }, [exporting, file.name, index, model, saveFile, system])

  // Once the export copy is in the page, hand it to the exporter.
  useEffect(() => {
    if (!exporting) return
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => exporting.resolve(exportRef.current))
    )
    return () => cancelAnimationFrame(id)
  }, [exporting])

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useTopWindowKeydown((e) => {
    if (presenting !== null || e.defaultPrevented || menu) return
    const target = e.target as HTMLElement | null
    const onButton = target?.tagName === 'BUTTON'
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const handled = () => e.preventDefault()
    if (mod) {
      if (key === 'z' && !e.shiftKey) return (handled(), undo())
      if (key === 'y' || (key === 'z' && e.shiftKey)) return (handled(), redo())
      if (key === 'o') return (handled(), file.open())
      if (key === 'm') return (handled(), newSlide())
      if (key === 'a') return (handled(), setSelection(shapes.map((s) => s.id)))
      if (key === 'c') return void copy()
      if (key === 'x') {
        if (copy()) deleteSelection()
        return
      }
      if (key === 'd') return (handled(), duplicateShapes())
      if (key === 'b' || key === 'i' || key === 'u')
        return (handled(), toggle(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline'))
      if (key === 'e' || key === 'l' || key === 'r' || key === 'j') {
        if (textTargets.length === 0) return
        return (
          handled(),
          align(key === 'e' ? 'ctr' : key === 'l' ? 'l' : key === 'r' ? 'r' : 'just')
        )
      }
      if (key === ']' || key === '>' || key === '.') return (handled(), setSize('up'))
      if (key === '[' || key === '<' || key === ',') return (handled(), setSize('down'))
    }
    if (key === 'F5') return (handled(), setPresenting(e.shiftKey ? index : 0))
    if (onButton && (key === 'Enter' || key === ' ')) return
    if (key === 'Delete' || key === 'Backspace') {
      if (selection.length) return (handled(), deleteSelection())
      return
    }
    if (key === 'Escape') {
      if (selection.length) return (handled(), setSelection([]))
      return
    }
    if (
      (key === 'Enter' || key === 'F2') &&
      selection.length === 1 &&
      canEditText(selectedShapes[0])
    ) {
      return (handled(), startEdit(selection[0], key === 'F2' ? 'all' : 'end'))
    }
    if (key === 'Tab' && shapes.length) {
      handled()
      const at = selection.length
        ? shapes.findIndex((s) => s.id === selection[selection.length - 1])
        : -1
      const next = (at + (e.shiftKey ? -1 : 1) + shapes.length) % shapes.length
      return setSelection([shapes[next].id])
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    if (arrows[key] && !onButton) {
      handled()
      if (selection.length) {
        // A coarse nudge is the grid step (1/12 inch); Ctrl or Alt nudges by a point.
        const step = mod || e.altKey ? 12700 : 76200
        return nudge(arrows[key][0] * step, arrows[key][1] * step)
      }
      return goTo(index + (arrows[key][0] || arrows[key][1]))
    }
    // Space steps through the slides when nothing is selected, as in the built-in viewer.
    if (key === ' ' && !selection.length && !onButton) return (handled(), goTo(index + 1))
    if (key === 'PageDown') return (handled(), goTo(index + 1))
    if (key === 'PageUp') return (handled(), goTo(index - 1))
    if (key === 'Home' && !selection.length) return (handled(), goTo(0))
    if (key === 'End' && !selection.length) return (handled(), goTo(slides.length - 1))
  })

  // Paste: shapes from the Slides clipboard, or a picture from the system's.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!system.window.isFocused() || presenting !== null) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      e.preventDefault()
      if (file) void pastePicture(file)
      else paste()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [paste, pastePicture, presenting, system])

  // ── Rendering ──────────────────────────────────────────────────────────────

  const slideBox = { width: BASE_WIDTH, height: model ? slideHeight(model) : BASE_WIDTH * 0.5625 }
  const scale = resolveScale(zoom, slideBox, {
    width: Math.max(0, viewport.width - STAGE_PAD),
    height: Math.max(0, viewport.height - STAGE_PAD),
  })

  const caretState = editing ? editState : null
  const style = firstStyle(textTargets[0])
  const toolbarState: ToolbarState = {
    name: file.name,
    dirty: store.dirty,
    saving: file.saving,
    exporting: exporting !== null,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    undoLabel: store.undoLabel,
    redoLabel: store.redoLabel,
    slideCount: slides.length,
    current: index,
    zoomLabel: zoomLabel(zoom, scale),
    showRail,
    showNotes,
    hasSelection: selection.length > 0,
    hasText: editing !== null || textTargets.length > 0,
    bold: caretState ? caretState.bold : !!style?.bold,
    italic: caretState ? caretState.italic : !!style?.italic,
    underline: caretState ? caretState.underline : !!style?.underline,
    sizeLabel: String((caretState ? caretState.sizePt : style?.sizePt) ?? '—'),
    canDownload: file.download !== null,
  }

  const actions: ToolbarActions = {
    newDeck: file.newDeck,
    open: file.open,
    save: () => {
      commitEditing()
      file.save()
    },
    saveAs: () => {
      commitEditing()
      file.saveAs()
    },
    undo,
    redo,
    toggleRail: () => setShowRail((v) => !v),
    prev: () => goTo(index - 1),
    next: () => goTo(index + 1),
    zoomOut: () => setZoom(stepZoom(scale, -1)),
    zoomIn: () => setZoom(stepZoom(scale, 1)),
    toggleFit: () =>
      setZoom((z) => ({ mode: z.mode === 'fit-page' ? 'fit-width' : 'fit-page', scale: 1 })),
    toggleNotes: () => setShowNotes((v) => !v),
    present: () => {
      commitEditing()
      setPresenting(index)
    },
    exportPng: () => void exportPng(),
    download: () => file.download?.(),
    newSlideMenu: (at) => openMenu(at, 'New slide', layoutItems()),
    duplicateSlide: () => duplicateSlide(),
    deleteSlide: () => deleteSlide(),
    insertTextBox: insertText,
    insertPicture: () => void insertImage(),
    shapeMenu: (at) =>
      openMenu(
        at,
        'Shapes',
        INSERTABLE_SHAPES.map((s) => ({ label: s.label, onSelect: () => insertPreset(s.preset) }))
      ),
    toggle,
    sizeMenu: (at) =>
      openMenu(
        at,
        'Font size',
        FONT_SIZES.map((size) => ({
          label: String(size),
          checked: toolbarState.sizeLabel === String(size),
          onSelect: () => setSize(size),
        }))
      ),
    sizeStep: (d) => setSize(d > 0 ? 'up' : 'down'),
    colorMenu: (at) =>
      openMenu(
        at,
        'Font colour',
        colorMenu(scheme, (hex) => hex && setColor(hex), closeMenu, null)
      ),
    align,
    fillMenu: (at) =>
      openMenu(
        at,
        'Shape fill',
        colorMenu(
          scheme,
          (hex) =>
            slidePart && act('Shape fill', () => fillShapes(deck, slidePart, selection, hex)),
          closeMenu,
          'No fill'
        )
      ),
    outlineMenu: (at) =>
      openMenu(
        at,
        'Shape outline',
        colorMenu(
          scheme,
          (hex) =>
            slidePart && act('Shape outline', () => outlineShapes(deck, slidePart, selection, hex)),
          closeMenu,
          'No outline'
        )
      ),
    arrangeMenu: (at) =>
      openMenu(at, 'Arrange', [
        { label: 'Bring to front', onSelect: () => restack('front') },
        { label: 'Bring forward', onSelect: () => restack('forward') },
        { label: 'Send backward', onSelect: () => restack('backward') },
        { label: 'Send to back', onSelect: () => restack('back') },
      ]),
    deleteShapes: () => deleteSelection(),
  }

  const getModel = useCallback((i: number) => store.model(i), [store])

  return (
    <div className="bg-surface-container-lowest flex h-full min-h-0 flex-col">
      <Toolbar state={toolbarState} actions={actions} />
      <div className="flex min-h-0 flex-1">
        {showRail && slides.length > 0 && (
          <Rail
            count={slides.length}
            current={index}
            model={getModel}
            version={version}
            onSelect={goTo}
            onMove={moveSlide}
            onDelete={deleteSlide}
            onContextMenu={slideMenu}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Stage
            model={model}
            scale={scale}
            selection={selection}
            editing={editing && editing.part === slidePart ? editing : null}
            editorApi={editorApi}
            onSelect={setSelection}
            onStartEdit={startEdit}
            onExitEdit={exitEdit}
            onEditorSelection={refreshEditState}
            onCommitFrames={commitFrames}
            onContextMenu={stageMenu}
            attachViewport={attachViewport}
            empty={
              <div className="text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 py-12">
                <Presentation size={40} strokeWidth={1} />
                <span className="font-ui text-[12px]">This presentation has no slides</span>
                <Button
                  size="sm"
                  variant="primary"
                  className="flex items-center gap-1"
                  onClick={() => newSlide()}
                >
                  <Plus size={12} />
                  New slide
                </Button>
              </div>
            }
          />
          {showNotes && slidePart && (
            <NotesPane
              flushRef={notesFlush}
              slideNumber={index + 1}
              text={store.notes(index)}
              onCommit={(text) => {
                const part = slidePart
                const next = normalizeNotes(text)
                if (next !== store.deck.notesText(part))
                  act('Edit notes', () => deck.setNotesText(part, next))
              }}
            />
          )}
        </div>
      </div>
      {presenting !== null && slides.length > 0 && (
        <Presenter
          count={slides.length}
          start={Math.min(presenting, slides.length - 1)}
          model={getModel}
          onExit={(last) => {
            setPresenting(null)
            goTo(last)
          }}
        />
      )}
      {exporting && store.model(exporting.index) && (
        <div
          aria-hidden="true"
          style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }}
        >
          <div ref={exportRef}>
            <SlideView model={store.model(exporting.index)!} />
          </div>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          label={menu.label}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
