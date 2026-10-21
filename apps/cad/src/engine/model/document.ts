/**
 * The open drawing: entities by handle (insertion order is draw order),
 * layers, linetypes, blocks, units, and the undo history.
 *
 * Every change goes through a transaction. A command opens one when it starts
 * and closes it when it ends, so UNDO takes back the whole command (all the
 * segments of a LINE, every copy of a COPY), as AutoCAD does. A change made
 * outside any command (the layer dropdown, a grip drag) is its own step.
 */
import type { Block, Entity, EntityProps, EntityShape, Layer, Linetype, Units } from './types'
import { BYLAYER, DEFAULT_UNITS } from './types'

type EntityChange = { handle: string; before: Entity | undefined; after: Entity | undefined }

type TableState = { layers: Map<string, Layer>; currentLayer: string; units: Units }

export type UndoStep = {
  label: string
  entities: EntityChange[]
  tablesBefore?: TableState
  tablesAfter?: TableState
}

/** What changed, for listeners that keep derived state (the spatial index, the renderer). */
export type ChangeSet = {
  /** Entities added or replaced (their new values). */
  put: Entity[]
  /** Handles removed. */
  removed: string[]
  /** Layers, current layer or units changed. */
  tables: boolean
  /** Everything was replaced (a load): rebuild from scratch. */
  reset?: boolean
}

export type DocumentInit = {
  entities?: Entity[]
  layers?: Layer[]
  linetypes?: Linetype[]
  blocks?: Block[]
  currentLayer?: string
  units?: Units
  nextHandle?: number
  /** Text style names the file defines (kept so TEXT can refer to them). */
  textStyles?: string[]
}

const UNDO_LIMIT = 500

export const DEFAULT_LAYER: Layer = {
  name: '0',
  color: 7,
  linetype: 'Continuous',
  lineweight: -3,
  on: true,
  frozen: false,
  locked: false,
}

export const CONTINUOUS: Linetype = { name: 'Continuous', description: 'Solid line', pattern: [] }

/** Handles are upper-case hexadecimal, as DXF writes them. */
export const formatHandle = (n: number): string => n.toString(16).toUpperCase()

export class CadDocument {
  readonly entities = new Map<string, Entity>()
  layers = new Map<string, Layer>()
  readonly linetypes = new Map<string, Linetype>()
  readonly blocks = new Map<string, Block>()
  readonly textStyles: string[]
  currentLayer: string
  units: Units
  /** Bumped on every change; the file is dirty while it differs from the saved one. */
  version = 0
  private nextHandle: number
  private undoStack: UndoStep[] = []
  private redoStack: UndoStep[] = []
  private open: UndoStep | null = null
  private depth = 0
  private listeners = new Set<(c: ChangeSet) => void>()

  constructor(init: DocumentInit = {}) {
    for (const lt of [CONTINUOUS, ...(init.linetypes ?? [])]) {
      if (![...this.linetypes.keys()].some((k) => k.toUpperCase() === lt.name.toUpperCase())) {
        this.linetypes.set(lt.name, lt)
      }
    }
    for (const l of init.layers ?? []) this.layers.set(l.name, l)
    if (!this.layers.has('0')) this.layers = new Map([['0', DEFAULT_LAYER], ...this.layers])
    for (const b of init.blocks ?? []) this.blocks.set(b.name, b)
    let maxHandle = 0
    for (const e of init.entities ?? []) {
      this.entities.set(e.handle, e)
      const n = parseInt(e.handle, 16)
      if (Number.isFinite(n)) maxHandle = Math.max(maxHandle, n)
    }
    this.nextHandle = Math.max(init.nextHandle ?? 0, maxHandle + 1, 0x100)
    this.currentLayer =
      init.currentLayer && this.layers.has(init.currentLayer) ? init.currentLayer : '0'
    this.units = init.units ?? DEFAULT_UNITS
    this.textStyles = init.textStyles ?? ['Standard']
  }

  subscribe(listener: (c: ChangeSet) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(c: ChangeSet): void {
    this.version++
    for (const l of this.listeners) l(c)
  }

  get handleSeed(): number {
    return this.nextHandle
  }

  newHandle(): string {
    return formatHandle(this.nextHandle++)
  }

  getBlock = (name: string): Block | undefined => this.blocks.get(name)

  layer(name: string): Layer {
    return this.layers.get(name) ?? DEFAULT_LAYER
  }

  /** A new entity on the current layer with ByLayer colour and linetype. */
  create<S extends EntityShape>(shape: S, props: Partial<EntityProps> = {}): Entity {
    return {
      handle: this.newHandle(),
      layer: this.currentLayer,
      color: BYLAYER,
      linetype: 'ByLayer',
      ...props,
      ...shape,
    } as unknown as Entity
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  /** Start grouping changes into one undo step. Nested calls join the outer step. */
  begin(label: string): void {
    if (this.depth++ === 0) this.open = { label, entities: [] }
  }

  /** Close the step. A step with no changes leaves no trace in the history. */
  end(): void {
    if (this.depth === 0) return
    if (--this.depth > 0 || !this.open) return
    const step = this.open
    this.open = null
    if (step.entities.length === 0 && !step.tablesBefore) return
    if (step.tablesBefore) step.tablesAfter = this.tableState()
    this.undoStack.push(step)
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack = []
  }

  get inTransaction(): boolean {
    return this.depth > 0
  }

  /** Run `fn` as one undo step (or inside the open one). */
  transact<T>(label: string, fn: () => T): T {
    this.begin(label)
    try {
      return fn()
    } finally {
      this.end()
    }
  }

  private record(handle: string, before: Entity | undefined, after: Entity | undefined): void {
    const step = this.open
    if (!step) return
    const prior = step.entities.find((c) => c.handle === handle)
    if (prior) prior.after = after
    else step.entities.push({ handle, before, after })
  }

  private tableState(): TableState {
    return { layers: new Map(this.layers), currentLayer: this.currentLayer, units: this.units }
  }

  private touchTables(): void {
    if (this.open && !this.open.tablesBefore) this.open.tablesBefore = this.tableState()
  }

  // ── Edits ──────────────────────────────────────────────────────────────────

  add(...entities: Entity[]): void {
    this.transact('add', () => {
      for (const e of entities) {
        this.record(e.handle, this.entities.get(e.handle), e)
        this.entities.set(e.handle, e)
      }
    })
    this.emit({ put: entities, removed: [], tables: false })
  }

  /** Replace entities by handle with new values. */
  replace(...entities: Entity[]): void {
    const put = entities.filter((e) => this.entities.has(e.handle))
    if (put.length === 0) return
    this.transact('edit', () => {
      for (const e of put) {
        this.record(e.handle, this.entities.get(e.handle), e)
        this.entities.set(e.handle, e)
      }
    })
    this.emit({ put, removed: [], tables: false })
  }

  remove(...handles: string[]): void {
    const removed = handles.filter((h) => this.entities.has(h))
    if (removed.length === 0) return
    this.transact('erase', () => {
      for (const h of removed) {
        this.record(h, this.entities.get(h), undefined)
        this.entities.delete(h)
      }
    })
    this.emit({ put: [], removed, tables: false })
  }

  setLayer(layer: Layer, previousName?: string): void {
    this.transact('layer', () => {
      this.touchTables()
      const next = new Map<string, Layer>()
      let placed = false
      for (const [name, l] of this.layers) {
        if (name === (previousName ?? layer.name)) {
          next.set(layer.name, layer)
          placed = true
        } else next.set(name, l)
      }
      if (!placed) next.set(layer.name, layer)
      this.layers = next
      if (previousName && previousName !== layer.name && this.currentLayer === previousName) {
        this.currentLayer = layer.name
      }
    })
    this.emit({ put: [], removed: [], tables: true })
  }

  deleteLayer(name: string): boolean {
    if (name === '0' || name === this.currentLayer) return false
    if ([...this.entities.values()].some((e) => e.layer === name)) return false
    this.transact('layer', () => {
      this.touchTables()
      const next = new Map(this.layers)
      next.delete(name)
      this.layers = next
    })
    this.emit({ put: [], removed: [], tables: true })
    return true
  }

  setCurrentLayer(name: string): void {
    if (!this.layers.has(name) || name === this.currentLayer) return
    this.transact('current layer', () => {
      this.touchTables()
      this.currentLayer = name
    })
    this.emit({ put: [], removed: [], tables: true })
  }

  setUnits(units: Units): void {
    this.transact('units', () => {
      this.touchTables()
      this.units = units
    })
    this.emit({ put: [], removed: [], tables: true })
  }

  addLinetype(lt: Linetype): void {
    if ([...this.linetypes.keys()].some((k) => k.toUpperCase() === lt.name.toUpperCase())) return
    this.linetypes.set(lt.name, lt)
    this.emit({ put: [], removed: [], tables: true })
  }

  // ── Undo ───────────────────────────────────────────────────────────────────

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null
  }

  undo(): string | null {
    const step = this.undoStack.pop()
    if (!step) return null
    this.applyStep(step, 'before')
    this.redoStack.push(step)
    return step.label
  }

  redo(): string | null {
    const step = this.redoStack.pop()
    if (!step) return null
    this.applyStep(step, 'after')
    this.undoStack.push(step)
    return step.label
  }

  private applyStep(step: UndoStep, side: 'before' | 'after'): void {
    const put: Entity[] = []
    const removed: string[] = []
    const changes = side === 'before' ? [...step.entities].reverse() : step.entities
    for (const c of changes) {
      const value = c[side]
      if (value) {
        this.entities.set(c.handle, value)
        put.push(value)
      } else if (this.entities.delete(c.handle)) removed.push(c.handle)
    }
    const tables = side === 'before' ? step.tablesBefore : step.tablesAfter
    if (tables) {
      this.layers = new Map(tables.layers)
      this.currentLayer = tables.currentLayer
      this.units = tables.units
    }
    this.emit({ put, removed, tables: tables !== undefined })
  }

  /** Every entity, in draw order. */
  all(): Entity[] {
    return [...this.entities.values()]
  }
}
