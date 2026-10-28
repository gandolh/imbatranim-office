/**
 * The editor: one open drawing with its view, selection, drafting toggles
 * and the running command. It has no DOM and no React: the UI forwards
 * typed text, pointer events and keys, and draws from what it exposes; the
 * tests drive it the same way.
 */
import { translation } from './geom/affine'
import type { Seg } from './geom/seg'
import { angleFrom, dist, norm, polar, sub, toDegrees, type Vec } from './geom/vec'
import { CadDocument } from './model/document'
import {
  applyGrip,
  entityGrips,
  entitySegs,
  isEmptyBounds,
  transformEntity,
  type Bounds,
} from './model/geometry'
import type { Entity, Layer, Units } from './model/types'
import { formatAngle, formatDistance, formatPoint, parseAngle, parseDistance } from './model/units'
import { COMMANDS, findCommand } from './commands/registry'
import {
  kw,
  type Answer,
  type CommandContext,
  type CommandDef,
  type CommandGen,
  type CommandSettings,
  type Keyword,
  type Preview,
  type Prompt,
} from './commands/types'
import { parsePointInput } from './input/coords'
import { boundsInside, entityDistance, touchesRect } from './input/select'
import {
  findSnap,
  orthoPoint,
  polarPoint,
  SNAP_MODES,
  type PolarHit,
  type SnapHit,
  type SnapMode,
} from './input/snap'
import { DisplayCache } from './render/display'
import { Renderer } from './render/renderer'
import { SpatialIndex } from './render/spatial'
import { View } from './view'

/** Pick box and snap aperture, CSS pixels (half-size). */
export const PICKBOX = 5
/** Objects this close to the nearest one (CSS px) count as a tie an `entity` prompt's `prefer` breaks. */
export const PICK_TIE = 1.5
export const APERTURE = 8
/** Grips are this many pixels across. */
export const GRIP_SIZE = 8
const DRAG_THRESHOLD = 4
const HISTORY_LIMIT = 300
const ZOOM_HISTORY = 50

export type Toggles = {
  ortho: boolean
  polar: boolean
  osnap: boolean
  snapModes: SnapMode[]
  /** Polar tracking increment, degrees. */
  polarIncrement: number
}

/** What the UI shows outside the canvas; a new object whenever any of it changes. */
export type EditorState = {
  version: number
  prompt: string
  keywords: Keyword[]
  commandName: string | null
  history: string[]
  toggles: Toggles
  selectionCount: number
  /** The selected objects' layer: a name, '' when they differ, null with nothing selected. */
  selectionLayer: string | null
  currentLayer: string
  layers: Layer[]
  units: Units
  canUndo: boolean
  canRedo: boolean
  docVersion: number
  /** The prompt wants free text (Space is a character, not Enter). */
  wantsText: boolean
}

export type Change = 'state' | 'scene' | 'overlay'

/** What the overlay canvas draws, in world coordinates. */
export type OverlayModel = {
  cursor: Vec | null
  /** Show the crosshair (a point is being picked) or the pick box (objects are). */
  cursorMode: 'crosshair' | 'pickbox' | 'both'
  snap: SnapHit | null
  polar: (PolarHit & { base: Vec }) | null
  ortho: { base: Vec; point: Vec } | null
  rubber: Seg[]
  preview: Entity[]
  previewSegs: Seg[]
  highlight: string[]
  hover: string | null
  grips: { point: Vec; hot: boolean }[]
  window: { a: Vec; b: Vec; crossing: boolean } | null
  /** A line of text near the cursor: polar or snap readout. */
  tooltip: string | null
}

type Active = {
  def: CommandDef
  gen: CommandGen
  prompt: Prompt
  /** Objects gathered by a select prompt so far. */
  picked: Set<string>
  /** A distance or angle prompt without a base: the first of its two clicks. */
  firstClick: Vec | null
}

type Pointer = { screen: Vec; world: Vec; buttons: number }

const DEFAULT_SETTINGS: CommandSettings = {
  offsetDistance: 1,
  filletRadius: 0,
  textHeight: 2.5,
  circleRadius: 1,
}

function matchKeyword(keywords: readonly Keyword[] | undefined, text: string): Keyword | null {
  const t = text.trim().toUpperCase().replace(/^_/, '')
  if (!keywords || t === '') return null
  return (
    keywords.find((k) => k.alias.toUpperCase() === t || k.name.toUpperCase() === t) ??
    keywords.find((k) => k.name.toUpperCase().startsWith(t) && t.length >= k.alias.length) ??
    null
  )
}

export class Editor {
  readonly doc: CadDocument
  readonly index: SpatialIndex
  readonly cache: DisplayCache
  readonly renderer: Renderer
  readonly view = new View()
  readonly selection = new Set<string>()
  readonly settings: CommandSettings = { ...DEFAULT_SETTINGS }
  toggles: Toggles = {
    ortho: false,
    polar: true,
    osnap: true,
    snapModes: [...SNAP_MODES],
    polarIncrement: 45,
  }
  private history: string[] = []
  private active: Active | null = null
  private lastCommand: string | null = null
  private lastPoint: Vec | null = null
  private pointer: Pointer | null = null
  private effective: {
    point: Vec
    snap: SnapHit | null
    polar: PolarHit | null
    ortho: boolean
  } | null = null
  private windowSel: { start: Vec; startScreen: Vec; armed: boolean; drag: boolean } | null = null
  private hover: string | null = null
  private panDrag: Vec | null = null
  private zoomStack: { cx: number; cy: number; scale: number }[] = []
  private listeners = new Set<(c: Change) => void>()
  private stateVersion = 0
  private stateCache: EditorState | null = null
  private segCache = new WeakMap<Entity, Seg[]>()
  private unsubscribe: () => void
  private layerDialogHandler: (() => void) | null = null

  constructor(doc: CadDocument = new CadDocument()) {
    this.doc = doc
    this.index = new SpatialIndex(doc)
    this.cache = new DisplayCache(doc)
    this.renderer = new Renderer(doc, this.index, this.cache)
    this.unsubscribe = doc.subscribe((c) => {
      if (c.tables) this.cache.invalidate()
      for (const h of c.removed) {
        this.selection.delete(h)
        if (this.hover === h) this.hover = null
      }
      this.changed('scene')
      this.changed('state')
    })
  }

  /** What LAYER opens (the UI's dialog). Returns the unregister function. */
  handleLayerDialog(handler: () => void): () => void {
    this.layerDialogHandler = handler
    return () => {
      if (this.layerDialogHandler === handler) this.layerDialogHandler = null
    }
  }

  dispose(): void {
    this.unsubscribe()
    this.index.dispose()
    this.listeners.clear()
  }

  subscribe(l: (c: Change) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private changed(c: Change): void {
    if (c === 'state') {
      this.stateVersion++
      this.stateCache = null
    }
    for (const l of this.listeners) l(c)
    if (c === 'scene') for (const l of this.listeners) l('overlay')
  }

  // ── State for the UI ───────────────────────────────────────────────────────

  get state(): EditorState {
    if (this.stateCache) return this.stateCache
    const p = this.active?.prompt
    this.stateCache = {
      version: this.stateVersion,
      prompt: p ? p.message : 'Command:',
      keywords: p?.keywords ?? [],
      commandName: this.active?.def.name ?? null,
      history: this.history,
      toggles: this.toggles,
      selectionCount: this.selection.size,
      selectionLayer: this.selectionLayer(),
      currentLayer: this.doc.currentLayer,
      layers: [...this.doc.layers.values()],
      units: this.doc.units,
      canUndo: this.doc.canUndo,
      canRedo: this.doc.canRedo,
      docVersion: this.doc.version,
      wantsText: p?.kind === 'text',
    }
    return this.stateCache
  }

  private selectionLayer(): string | null {
    if (this.selection.size === 0 || this.active) return null
    let layer: string | null = null
    for (const h of this.selection) {
      const e = this.doc.entities.get(h)
      if (!e) continue
      if (layer === null) layer = e.layer
      else if (layer !== e.layer) return ''
    }
    return layer
  }

  get isIdle(): boolean {
    return this.active === null
  }

  get cursorWorld(): Vec | null {
    return this.effective?.point ?? this.pointer?.world ?? null
  }

  message(text: string): void {
    this.history = [...this.history, text].slice(-HISTORY_LIMIT)
    this.changed('state')
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  private context(): CommandContext {
    return {
      doc: this.doc,
      settings: this.settings,
      takeSelection: () => {
        if (this.selection.size === 0) return null
        const list = [...this.selection]
        this.selection.clear()
        this.changed('overlay')
        return list
      },
      message: (t) => this.message(t),
      segsOf: (e) => this.segsOf(e),
      entitiesIn: (box) => this.entitiesIn(box),
      zoomExtents: () => this.zoomExtents(),
      zoomWindow: (a, b) => this.zoomWindow(a, b),
      zoomBy: (f) => this.zoomBy(f),
      zoomPrevious: () => this.zoomPrevious(),
      openLayerDialog: () => {
        if (this.layerDialogHandler) this.layerDialogHandler()
        else this.message('The layer table is not available here; use -LAYER.')
      },
      undo: (n) => {
        let done = 0
        for (let i = 0; i < n && this.doc.undo() !== null; i++) done++
        return done
      },
      redo: () => this.doc.redo() !== null,
    }
  }

  /** Start a command by name or alias. A running command is cancelled first, as toolbar buttons do. */
  run(name: string): boolean {
    const def = findCommand(name)
    if (!def) {
      this.message(
        `Unknown command "${name.trim().toUpperCase()}". Type a command name, such as LINE.`
      )
      return false
    }
    if (this.active) this.cancel()
    this.message(`Command: ${def.name}`)
    this.startCommand(def, def.run(this.context()))
    return true
  }

  private startCommand(def: CommandDef, gen: CommandGen): void {
    if (def.name !== 'UNDO' && def.name !== 'U' && def.name !== 'REDO') this.lastCommand = def.name
    const usesHistory = def.name === 'UNDO' || def.name === 'U' || def.name === 'REDO'
    if (!usesHistory) this.doc.begin(def.name)
    this.active = {
      def,
      gen,
      prompt: { kind: 'point', message: '' },
      picked: new Set(),
      firstClick: null,
    }
    this.advance(undefined, usesHistory)
  }

  private advance(answer: Answer | undefined, noTransaction = false): void {
    const a = this.active
    if (!a) return
    let r: IteratorResult<Prompt, void>
    try {
      r = answer === undefined ? a.gen.next(undefined as unknown as Answer) : a.gen.next(answer)
    } catch (err) {
      this.message(`${a.def.name} failed: ${err instanceof Error ? err.message : String(err)}`)
      this.finish(noTransaction)
      return
    }
    if (r.done) {
      this.finish(noTransaction)
      return
    }
    a.prompt = r.value
    a.picked = new Set()
    a.firstClick = null
    if (a.prompt.kind === 'select' && this.selection.size > 0) {
      // Objects picked before the command count as its selection (noun-verb).
      for (const h of this.selection) a.picked.add(h)
    }
    this.windowSel = null
    this.updateEffective()
    this.changed('state')
    this.changed('overlay')
  }

  private finish(noTransaction = false): void {
    const name = this.active?.def.name
    this.active = null
    this.windowSel = null
    this.panDrag = null
    if (!noTransaction && name !== 'UNDO' && name !== 'U' && name !== 'REDO') this.doc.end()
    this.effective = null
    this.updateEffective()
    this.changed('state')
    this.changed('overlay')
  }

  /** Esc: cancel the command (what it already drew stays), or clear the selection. */
  cancel(): void {
    if (this.active) {
      this.message('*Cancel*')
      try {
        this.active.gen.return(undefined)
      } catch {
        // A command's own cleanup failing must not keep the editor stuck.
      }
      this.finish()
      return
    }
    if (this.windowSel) {
      this.windowSel = null
      this.changed('overlay')
      return
    }
    if (this.selection.size > 0) {
      this.selection.clear()
      this.changed('state')
      this.changed('overlay')
    }
  }

  private echo(text: string): void {
    const p = this.active?.prompt
    this.message(p ? `${p.message} ${text}` : text)
  }

  /** A line typed into the command line (Enter or Space). */
  submit(raw: string): void {
    const text = raw.trim()
    const a = this.active
    if (!a) {
      if (text === '') {
        if (this.lastCommand) this.run(this.lastCommand)
        return
      }
      this.run(text)
      return
    }
    const p = a.prompt
    if (text === '') return this.enter()
    if (p.kind === 'text') {
      this.echo(raw)
      return this.advance({ kind: 'text', value: raw.replace(/^\s+|\s+$/g, '') })
    }
    const k = matchKeyword(p.keywords, text)
    if (k) {
      this.echo(text)
      return this.advance({ kind: 'keyword', name: k.name })
    }
    const units = this.doc.units
    switch (p.kind) {
      case 'point': {
        if (p.acceptFactor && /^(\d+(\.\d*)?|\.\d+)x?$/i.test(text)) {
          this.echo(text)
          return this.advance({ kind: 'number', value: parseFloat(text) })
        }
        // `@` is relative to the prompt's own base (the previous vertex), else the last point entered.
        const t = parsePointInput(text, units, p.base ?? this.lastPoint)
        if (!t) return this.invalid('Point or option keyword required.')
        if (t.kind === 'direct') {
          if (!p.base) return this.invalid('Point or option keyword required.')
          const toward = this.effective?.point ?? this.pointer?.world
          const dir =
            toward && dist(toward, p.base) > 0 ? norm(sub(toward, p.base)) : { x: 1, y: 0 }
          this.echo(text)
          return this.answerPoint(polar(p.base, t.distance, Math.atan2(dir.y, dir.x)))
        }
        this.echo(text)
        return this.answerPoint(t.p)
      }
      case 'distance':
      case 'number': {
        const d = p.kind === 'distance' ? parseDistance(text, units) : Number(text)
        if (d !== null && Number.isFinite(d)) {
          this.echo(text)
          return this.advance({ kind: 'number', value: d })
        }
        const t = parsePointInput(text, units, p.base ?? this.lastPoint)
        if (t?.kind === 'point' && p.base) {
          this.echo(text)
          return this.advance({ kind: 'number', value: dist(p.base, t.p) })
        }
        return this.invalid(
          p.kind === 'distance' ? 'Requires a distance or two points.' : 'Requires a number.'
        )
      }
      case 'angle': {
        const v = parseAngle(text)
        if (v !== null) {
          this.echo(text)
          return this.advance({ kind: 'number', value: v })
        }
        const t = parsePointInput(text, units, p.base ?? this.lastPoint)
        if (t?.kind === 'point' && p.base) {
          this.echo(text)
          return this.advance({ kind: 'number', value: angleFrom(p.base, t.p) })
        }
        return this.invalid('Requires an angle in degrees or a point.')
      }
      case 'select': {
        if (/^all$/i.test(text)) {
          for (const e of this.doc.entities.values()) if (this.selectable(e)) a.picked.add(e.handle)
          this.echo(text)
          this.message(`${a.picked.size} found`)
          this.changed('overlay')
          return
        }
        return this.invalid('Pick objects, drag a window, type ALL, or press Enter.')
      }
      case 'keyword':
        return this.invalid('Invalid option keyword.')
      default:
        return this.invalid('Pick an object, or use an option.')
    }
  }

  private invalid(why: string): void {
    this.message(why)
  }

  /** Enter (or Space) on an empty command line. */
  enter(): void {
    const a = this.active
    if (!a) return this.submit('')
    const p = a.prompt
    switch (p.kind) {
      case 'select':
        this.echo('')
        if (a.picked.size > 0) this.message(`${a.picked.size} selected`)
        this.selection.clear()
        return this.advance({ kind: 'selection', handles: [...a.picked] })
      case 'keyword':
        if (p.default) {
          this.echo('')
          return this.advance({ kind: 'keyword', name: p.default })
        }
        break
      case 'distance':
      case 'angle':
      case 'number':
        if (p.default !== undefined) {
          this.echo('')
          return this.advance({ kind: 'number', value: p.default })
        }
        break
      case 'text':
        this.echo('')
        return this.advance({ kind: 'text', value: p.default ?? '' })
      default:
        break
    }
    if (p.allowNone || p.kind === 'pan') {
      this.echo('')
      return this.advance({ kind: 'none' })
    }
  }

  private answerPoint(p: Vec): void {
    this.lastPoint = p
    this.advance({ kind: 'point', p })
  }

  // ── Pointer ────────────────────────────────────────────────────────────────

  private aperture(px = APERTURE): number {
    return px / this.view.scale
  }

  private wantsPoint(): boolean {
    const p = this.active?.prompt
    return (
      !!p &&
      (p.kind === 'point' ||
        ((p.kind === 'distance' || p.kind === 'angle' || p.kind === 'number') &&
          (!!p.base || !!this.active?.firstClick)))
    )
  }

  private promptBase(): Vec | null {
    const a = this.active
    if (!a) return null
    const p = a.prompt
    if (p.kind === 'point' || p.kind === 'distance' || p.kind === 'angle' || p.kind === 'number')
      return p.base ?? a.firstClick
    return null
  }

  private updateEffective(): void {
    if (!this.pointer || !this.wantsPoint()) {
      this.effective = null
      return
    }
    const raw = this.pointer.world
    const base = this.promptBase()
    let snap: SnapHit | null = null
    if (this.toggles.osnap && this.toggles.snapModes.length > 0) {
      const h = this.aperture()
      const segs: Seg[] = []
      const points: Vec[] = []
      for (const e of this.entitiesIn(
        { minX: raw.x - h, minY: raw.y - h, maxX: raw.x + h, maxY: raw.y + h },
        true
      )) {
        segs.push(...this.segsOf(e))
        if (e.kind === 'point') points.push(e.p)
      }
      snap = findSnap({
        segs,
        points,
        cursor: raw,
        aperture: h,
        modes: new Set(this.toggles.snapModes),
        base,
      })
    }
    if (snap) {
      this.effective = { point: snap.point, snap, polar: null, ortho: false }
      return
    }
    if (base && this.toggles.ortho) {
      this.effective = { point: orthoPoint(base, raw), snap: null, polar: null, ortho: true }
      return
    }
    if (base && this.toggles.polar) {
      const hit = polarPoint(
        base,
        raw,
        (this.toggles.polarIncrement * Math.PI) / 180,
        this.aperture(6)
      )
      if (hit) {
        this.effective = { point: hit.point, snap: null, polar: hit, ortho: false }
        return
      }
    }
    this.effective = { point: raw, snap: null, polar: null, ortho: false }
  }

  pointerMove(screen: Vec, buttons = 0): void {
    const world = this.view.toWorld(screen)
    const prev = this.pointer
    this.pointer = { screen, world, buttons }
    if (this.panDrag) {
      this.view.panBy(screen.x - this.panDrag.x, screen.y - this.panDrag.y)
      this.panDrag = screen
      this.pointer = { screen, world: this.view.toWorld(screen), buttons }
      this.changed('scene')
      return
    }
    if (this.windowSel && !this.windowSel.drag && prev && buttons & 1) {
      if (dist(screen, this.windowSel.startScreen) > DRAG_THRESHOLD) this.windowSel.drag = true
    }
    this.updateEffective()
    const p = this.active?.prompt
    if (!this.wantsPoint() && (!p || p.kind === 'select' || p.kind === 'entity')) {
      this.hover = this.windowSel ? null : this.pick(screen)
    } else this.hover = null
    this.changed('overlay')
  }

  pointerLeave(): void {
    this.pointer = null
    this.effective = null
    this.hover = null
    this.changed('overlay')
  }

  /** button: 0 left, 1 middle, 2 right. */
  pointerDown(screen: Vec, button: number, mods: { shift?: boolean } = {}): void {
    // Bring the cursor here first (a press is not a drag).
    this.pointerMove(screen, 0)
    if (button === 1 || (button === 0 && this.active?.prompt.kind === 'pan')) {
      this.panDrag = screen
      return
    }
    if (button === 2) {
      // Right-click is Enter, as in AutoCAD.
      this.enter()
      return
    }
    if (button !== 0) return
    const world = this.view.toWorld(screen)
    const a = this.active
    if (!a) return this.idleClick(screen, world, !!mods.shift)
    const p = a.prompt
    switch (p.kind) {
      case 'point': {
        const pt = this.effective?.point ?? world
        this.echo(formatPoint(pt, this.doc.units))
        return this.answerPoint(pt)
      }
      case 'distance':
      case 'angle':
      case 'number': {
        const pt = this.effective?.point ?? world
        const base = p.base ?? a.firstClick
        if (!base) {
          a.firstClick = pt
          this.updateEffective()
          this.changed('overlay')
          return
        }
        if (p.kind === 'angle') {
          const ang = angleFrom(base, pt)
          this.echo(formatAngle(ang))
          return this.advance({ kind: 'number', value: ang })
        }
        const d = dist(base, pt)
        this.echo(formatDistance(d, this.doc.units))
        return this.advance({ kind: 'number', value: d })
      }
      case 'entity': {
        const h = this.pickFor(screen, world, p)
        if (h.refused !== null) {
          this.message(h.refused)
          return
        }
        this.echo('')
        return this.advance({ kind: 'entity', handle: h.handle, at: world })
      }
      case 'select':
        return this.selectClick(screen, world, !!mods.shift, a.picked)
      default:
        return
    }
  }

  pointerUp(screen: Vec, button: number): void {
    if (this.panDrag && (button === 1 || button === 0)) {
      this.panDrag = null
      return
    }
    const w = this.windowSel
    if (button === 0 && w && w.drag) {
      this.finishWindow(this.view.toWorld(screen))
    }
  }

  wheel(screen: Vec, deltaY: number): void {
    this.view.zoomAt(screen, deltaY < 0 ? 1.2 : 1 / 1.2)
    if (this.pointer)
      this.pointer = { ...this.pointer, world: this.view.toWorld(this.pointer.screen) }
    this.updateEffective()
    this.changed('scene')
  }

  private idleClick(screen: Vec, world: Vec, shift: boolean): void {
    // A grip of a selected object: start editing it.
    const g = this.gripAt(screen)
    if (g) return this.startGrip(g.handle, g.index, g.point)
    this.selectClick(screen, world, shift, this.selection)
  }

  private selectClick(screen: Vec, world: Vec, shift: boolean, set: Set<string>): void {
    if (this.windowSel && !this.windowSel.drag) {
      this.finishWindow(world)
      return
    }
    const h = this.pick(screen)
    if (h) {
      if (shift) set.delete(h)
      else set.add(h)
      this.changed('state')
      this.changed('overlay')
      return
    }
    this.windowSel = { start: world, startScreen: screen, armed: true, drag: false }
    this.changed('overlay')
  }

  private finishWindow(end: Vec): void {
    const w = this.windowSel
    this.windowSel = null
    if (!w) return
    const crossing = end.x < w.start.x
    const r: Bounds = {
      minX: Math.min(w.start.x, end.x),
      minY: Math.min(w.start.y, end.y),
      maxX: Math.max(w.start.x, end.x),
      maxY: Math.max(w.start.y, end.y),
    }
    const set = this.active?.prompt.kind === 'select' ? this.active.picked : this.selection
    let n = 0
    for (const h of this.index.search(r)) {
      const e = this.doc.entities.get(h)
      if (!e || !this.selectable(e)) continue
      const b = this.index.bounds(h)
      const inside = b ? boundsInside(b, r) : false
      if (inside || (crossing && touchesRect(e, r, this.doc.getBlock))) {
        set.add(h)
        n++
      }
    }
    if (this.active?.prompt.kind === 'select') this.message(`${n} found`)
    this.changed('state')
    this.changed('overlay')
  }

  private selectable(e: Entity): boolean {
    const l = this.doc.layer(e.layer)
    return l.on && !l.frozen && !l.locked && !(e.kind === 'foreign' && e.paperSpace)
  }

  /** The object under the cursor (nearest within the pick box), or null. */
  pick(screen: Vec): string | null {
    return nearest(this.pickCandidates(screen))?.e.handle ?? null
  }

  /** Every selectable object within the pick box, with its distance (world units), in index order. */
  private pickCandidates(screen: Vec): PickCandidate[] {
    const p = this.view.toWorld(screen)
    const h = PICKBOX / this.view.scale
    const out: PickCandidate[] = []
    for (const handle of this.index.search({
      minX: p.x - h,
      minY: p.y - h,
      maxX: p.x + h,
      maxY: p.y + h,
    })) {
      const e = this.doc.entities.get(handle)
      if (!e || !this.selectable(e)) continue
      const d = entityDistance(e, p, this.doc.getBlock)
      if (d <= h) out.push({ e, d })
    }
    return out
  }

  /**
   * The answer to an `entity` prompt: the objects in the pick box its filter
   * accepts, nearest first, and among those about as near as the nearest
   * (within {@link PICK_TIE} px), the one its `prefer` ranks lowest. The
   * nearest keeps the pick unless another ranks lower by more than the tie, so
   * two parallel walls far from their ends still go to the nearer one. With
   * nothing accepted, says why the nearest refused object was, or that there
   * was nothing there.
   */
  private pickFor(
    screen: Vec,
    world: Vec,
    p: Extract<Prompt, { kind: 'entity' }>
  ): { handle: string; refused: null } | { handle: null; refused: string } {
    const all = this.pickCandidates(screen)
    const accepted = p.filter ? all.filter((c) => p.filter!(c.e) === null) : all
    const first = nearest(accepted)
    if (!first) {
      const refused = nearest(all)
      return {
        handle: null,
        refused: (refused && p.filter?.(refused.e)) || 'No object found there.',
      }
    }
    if (!p.prefer) return { handle: first.e.handle, refused: null }
    const tie = PICK_TIE / this.view.scale
    let best = first
    let bestRank = p.prefer(first.e, world)
    const firstRank = bestRank
    for (const c of accepted) {
      if (c === first || c.d > first.d + tie) continue
      const rank = p.prefer(c.e, world)
      if (rank < bestRank) {
        best = c
        bestRank = rank
      }
    }
    return {
      handle: (firstRank - bestRank > tie ? best : first).e.handle,
      refused: null,
    }
  }

  segsOf(e: Entity): Seg[] {
    let s = this.segCache.get(e)
    if (!s) {
      s = entitySegs(e, this.doc.getBlock)
      this.segCache.set(e, s)
    }
    return s
  }

  /** Visible entities touching a box (`includeLocked` for snapping, which works on locked layers). */
  entitiesIn(box: Bounds, includeLocked = false): Entity[] {
    const out: Entity[] = []
    const all = !Number.isFinite(box.minX) || !Number.isFinite(box.maxX)
    const handles = all ? [...this.doc.entities.keys()] : this.index.search(box)
    for (const h of handles) {
      const e = this.doc.entities.get(h)
      if (!e) continue
      const l = this.doc.layer(e.layer)
      if (!l.on || l.frozen || (l.locked && !includeLocked)) continue
      if (e.kind === 'foreign' && e.paperSpace) continue
      out.push(e)
    }
    return out
  }

  // ── Grips ──────────────────────────────────────────────────────────────────

  private gripAt(screen: Vec): { handle: string; index: number; point: Vec } | null {
    if (this.selection.size === 0 || this.selection.size > 500) return null
    for (const h of this.selection) {
      const e = this.doc.entities.get(h)
      if (!e) continue
      const grips = entityGrips(e)
      for (let i = 0; i < grips.length; i++) {
        const s = this.view.toScreen(grips[i].point)
        if (
          Math.abs(s.x - screen.x) <= GRIP_SIZE / 2 + 1 &&
          Math.abs(s.y - screen.y) <= GRIP_SIZE / 2 + 1
        ) {
          return { handle: h, index: i, point: grips[i].point }
        }
      }
    }
    return null
  }

  private startGrip(handle: string, index: number, point: Vec): void {
    const doc = this.doc
    const selected = [...this.selection]
    const owner = this.doc.entities.get(handle)
    const role = owner ? entityGrips(owner)[index]?.role : undefined
    const def: CommandDef = { name: 'GRIP', aliases: [], label: 'Grip edit', run: () => gen() }
    // Every selected object with a grip on this spot stretches with it (a shared corner moves as one).
    const stretched = (to: Vec): Entity[] => {
      const out: Entity[] = []
      for (const h of selected) {
        const e = doc.entities.get(h)
        if (!e) continue
        const grips = entityGrips(e)
        let next: Entity | null = e
        grips.forEach((g, i) => {
          if (
            next &&
            dist(g.point, point) <= 1e-9 * Math.max(1, Math.abs(point.x), Math.abs(point.y))
          ) {
            next = applyGrip(next, i, to) ?? next
          }
        })
        if (next !== e) out.push(next)
      }
      return out
    }
    const movedAll = (to: Vec): Entity[] =>
      selected
        .map((h) => doc.entities.get(h))
        .filter((e): e is Entity => e !== undefined)
        .map((e) => transformEntity(e, translation(to.x - point.x, to.y - point.y)))
        .filter((e): e is Entity => e !== null)
    function* gen(): CommandGen {
      let mode: 'STRETCH' | 'MOVE' = role === 'move' ? 'MOVE' : 'STRETCH'
      for (;;) {
        const a: Answer = yield {
          kind: 'point',
          message: `** ${mode} ** Specify ${mode === 'STRETCH' ? 'stretch' : 'move'} point or [eXit] (Enter for ${mode === 'STRETCH' ? 'MOVE' : 'STRETCH'}):`,
          base: point,
          keywords: [kw('eXit', 'X')],
          allowNone: true,
          preview: (p) => ({ entities: mode === 'STRETCH' ? stretched(p) : movedAll(p) }),
        }
        if (a.kind === 'none') {
          mode = mode === 'STRETCH' ? 'MOVE' : 'STRETCH'
          continue
        }
        if (a.kind !== 'point') return
        doc.replace(...(mode === 'STRETCH' ? stretched(a.p) : movedAll(a.p)))
        return
      }
    }
    this.message('Command: (grip)')
    this.startCommand(def, gen())
  }

  // ── View ───────────────────────────────────────────────────────────────────

  private fitted = false

  resize(width: number, height: number): void {
    this.view.resize(width, height)
    // The first real size fits the drawing; a window not laid out yet (0×0) does not count.
    if (!this.fitted && width > 50 && height > 50) {
      this.fitted = true
      this.zoomExtents(false)
    }
    this.changed('scene')
  }

  private pushView(): void {
    this.zoomStack.push(this.view.snapshot())
    if (this.zoomStack.length > ZOOM_HISTORY) this.zoomStack.shift()
  }

  zoomExtents(remember = true): void {
    const ext = this.index.extents()
    if (remember) this.pushView()
    if (!ext || isEmptyBounds(ext)) {
      this.view.cx = 0
      this.view.cy = 0
      this.view.scale = Math.min(this.view.width, this.view.height) / 20
    } else this.view.fit(ext)
    this.changed('scene')
  }

  zoomWindow(a: Vec, b: Vec): void {
    if (dist(a, b) === 0) return
    this.pushView()
    this.view.fit(
      {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      },
      0
    )
    this.changed('scene')
  }

  zoomBy(factor: number): void {
    this.pushView()
    this.view.zoomAt({ x: this.view.width / 2, y: this.view.height / 2 }, factor)
    this.changed('scene')
  }

  zoomPrevious(): boolean {
    const v = this.zoomStack.pop()
    if (!v) return false
    this.view.restore(v)
    this.changed('scene')
    return true
  }

  panBy(dx: number, dy: number): void {
    this.view.panBy(dx, dy)
    this.changed('scene')
  }

  // ── Toggles and direct actions ─────────────────────────────────────────────

  setToggles(patch: Partial<Toggles>): void {
    this.toggles = { ...this.toggles, ...patch }
    if (patch.ortho) this.toggles.polar = false
    if (patch.polar) this.toggles.ortho = false
    this.message(
      patch.ortho !== undefined
        ? `<Ortho ${this.toggles.ortho ? 'on' : 'off'}>`
        : patch.polar !== undefined
          ? `<Polar ${this.toggles.polar ? 'on' : 'off'}>`
          : patch.osnap !== undefined
            ? `<Osnap ${this.toggles.osnap ? 'on' : 'off'}>`
            : '<Drafting settings changed>'
    )
    this.updateEffective()
    this.changed('overlay')
  }

  /** Delete key: erase the selection (one undo step). */
  eraseSelection(): void {
    if (this.active || this.selection.size === 0) return
    const list = [...this.selection]
    this.doc.transact('ERASE', () => this.doc.remove(...list))
    this.message(`Erased ${list.length} object${list.length === 1 ? '' : 's'}.`)
  }

  /**
   * The layer dropdown: with objects selected, move them to the layer (one
   * undo step); with none, make it current.
   */
  chooseLayer(name: string): void {
    if (!this.doc.layers.has(name)) return
    if (this.selection.size > 0 && !this.active) {
      const list = [...this.selection]
        .map((h) => this.doc.entities.get(h))
        .filter((e): e is Entity => !!e)
      this.doc.transact('layer', () =>
        this.doc.replace(...list.map((e) => ({ ...e, layer: name })))
      )
      this.message(`${list.length} object${list.length === 1 ? '' : 's'} moved to layer "${name}".`)
      return
    }
    this.doc.setCurrentLayer(name)
  }

  undo(): void {
    if (this.active) this.cancel()
    const label = this.doc.undo()
    this.message(label ? `Undo ${label}` : 'Nothing to undo.')
  }

  redo(): void {
    if (this.active) this.cancel()
    const label = this.doc.redo()
    this.message(label ? `Redo ${label}` : 'Nothing to redo.')
  }

  selectAll(): void {
    if (this.active) return
    for (const e of this.doc.entities.values()) if (this.selectable(e)) this.selection.add(e.handle)
    this.changed('state')
    this.changed('overlay')
  }

  // ── Overlay ────────────────────────────────────────────────────────────────

  /** A short readout of where the cursor is. */
  cursorText(): string {
    const p = this.cursorWorld
    return p ? formatPoint(p, this.doc.units) : ''
  }

  overlay(): OverlayModel {
    const a = this.active
    const p = a?.prompt
    const base = this.promptBase()
    const eff = this.effective
    const cursor = this.pointer ? (eff?.point ?? this.pointer.world) : null
    const rubber: Seg[] = []
    let preview: Preview = {}
    if (p && cursor && this.wantsPoint()) {
      if (base && !(p.kind === 'point' && p.noRubber))
        rubber.push({ kind: 'line', a: base, b: cursor })
      const fn = 'preview' in p ? p.preview : undefined
      if (fn) {
        try {
          preview = fn(cursor)
        } catch {
          preview = {}
        }
      }
    }
    const highlight = new Set<string>(this.selection)
    if (a?.prompt.kind === 'select') for (const h of a.picked) highlight.add(h)
    const grips: { point: Vec; hot: boolean }[] = []
    if (!a && this.selection.size > 0 && this.selection.size <= 500) {
      for (const h of this.selection) {
        const e = this.doc.entities.get(h)
        if (e) for (const g of entityGrips(e)) grips.push({ point: g.point, hot: false })
      }
    }
    if (a?.def.name === 'GRIP' && base) grips.push({ point: base, hot: true })
    let tooltip: string | null = null
    const units = this.doc.units
    if (eff?.snap) tooltip = eff.snap.mode[0].toUpperCase() + eff.snap.mode.slice(1)
    else if (eff?.polar && base)
      tooltip = `Polar: ${formatDistance(eff.polar.distance, units)} < ${Math.round(toDegrees(eff.polar.angle) * 100) / 100}°`
    else if (eff?.ortho && base) tooltip = `Ortho: ${formatDistance(dist(base, eff.point), units)}`
    const w = this.windowSel
    return {
      cursor,
      cursorMode: this.wantsPoint()
        ? 'crosshair'
        : p && (p.kind === 'select' || p.kind === 'entity')
          ? 'pickbox'
          : 'both',
      snap: eff?.snap ?? null,
      polar: eff?.polar && base ? { ...eff.polar, base } : null,
      ortho: eff?.ortho && base ? { base, point: eff.point } : null,
      rubber,
      preview: preview.entities ?? [],
      previewSegs: preview.segs ?? [],
      highlight: [...highlight],
      hover: this.hover,
      grips,
      window:
        w && this.pointer
          ? { a: w.start, b: this.pointer.world, crossing: this.pointer.world.x < w.start.x }
          : null,
      tooltip,
    }
  }
}

export { COMMANDS }

type PickCandidate = { e: Entity; d: number }

/** The nearest candidate; on a tie the later one, as the pick always did. */
function nearest(cs: readonly PickCandidate[]): PickCandidate | null {
  let best: PickCandidate | null = null
  for (const c of cs) if (!best || c.d <= best.d) best = c
  return best
}
