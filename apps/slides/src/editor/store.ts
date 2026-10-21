/**
 * One open presentation in one window: the deck, its undo history, and the
 * render models the views draw, cached per slide until a part they read
 * changes.
 *
 * Every user action runs through {@link DeckStore.act}: a package transaction
 * records the parts it touched, and undo puts those parts back exactly. Undoing
 * to the state the file was saved in makes it clean again, and the parts come
 * back byte for byte, so a save after undo copies them through untouched.
 */
import { blankPresentation } from '../engine/blank'
import { Deck, type LayoutRef, type SlideRef } from '../engine/deck'
import { buildSlide, MediaCache, type SlideModel } from '../engine/model'
import { relsPartOf, type Change } from '../engine/opc'

type Step = { change: Change; label: string; token: number }

let stores = 0

export class DeckStore {
  /** Distinct per opened document (a React key). */
  readonly id = ++stores
  readonly deck: Deck
  readonly media: MediaCache
  private undoStack: Step[] = []
  private redoStack: Step[] = []
  private nextToken = 1
  /** Identifies the current state: 0 as opened, else the token of the last step applied. */
  private token = 0
  private savedToken = 0
  private version = 0
  private listeners = new Set<() => void>()
  private models = new Map<string, { key: string; model: SlideModel }>()
  private slideCache: { version: number; refs: SlideRef[] } | null = null

  private constructor(deck: Deck) {
    this.deck = deck
    this.media = new MediaCache(deck)
  }

  static open(bytes: Uint8Array): DeckStore {
    return new DeckStore(Deck.open(bytes))
  }

  /** A new, blank presentation (dirty until saved somewhere). */
  static blank(): DeckStore {
    const store = new DeckStore(Deck.open(blankPresentation()))
    store.savedToken = -1
    return store
  }

  // ── Subscription (useSyncExternalStore) ────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  private changed(): void {
    this.version++
    for (const l of this.listeners) l()
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  get dirty(): boolean {
    return this.token !== this.savedToken
  }

  /** The state token now: hand it to {@link markSaved} once the bytes are on disk. */
  get stateToken(): number {
    return this.token
  }

  slides(): SlideRef[] {
    if (this.slideCache?.version !== this.version) {
      this.slideCache = { version: this.version, refs: this.deck.slides() }
    }
    return this.slideCache.refs
  }

  layouts(): LayoutRef[] {
    return this.deck.layouts()
  }

  /** The render model of slide `index` (cached until a part it reads changes). */
  model(index: number): SlideModel | null {
    const ref = this.slides()[index]
    return ref ? this.modelOf(ref.part, index + 1) : null
  }

  /** The render model of any slide-like part (a slide, a layout for previews). */
  modelOf(part: string, number: number): SlideModel {
    const pkg = this.deck.pkg
    const layout = this.deck.layoutOf(part)
    const master = layout ? this.deck.masterOf(layout) : this.deck.masterOf(part)
    const theme = master ? this.deck.themeOf(master) : null
    const deps = [
      part,
      relsPartOf(part),
      layout,
      master,
      master ? relsPartOf(master) : null,
      theme,
      this.deck.presPart,
      'ppt/tableStyles.xml',
    ]
    if (layout) deps.push(relsPartOf(layout))
    const key = `${number}|${deps.map((d) => (d ? pkg.revision(d) : '-')).join(',')}`
    const cached = this.models.get(part)
    if (cached && cached.key === key) return cached.model
    const model = buildSlide(this.deck, part, number, this.media)
    this.models.set(part, { key, model })
    return model
  }

  notes(index: number): string {
    const ref = this.slides()[index]
    return ref ? this.deck.notesText(ref.part) : ''
  }

  // ── Changing ───────────────────────────────────────────────────────────────

  /**
   * Run one user action as one undo step. Returns the action's result; when
   * it throws, every part it touched is put back and the error rethrown.
   */
  act<T>(label: string, fn: () => T): T {
    const pkg = this.deck.pkg
    pkg.begin()
    let result: T
    try {
      result = fn()
    } catch (err) {
      pkg.rollback()
      this.changed()
      throw err
    }
    const change = pkg.commit()
    if (change) {
      const token = this.nextToken++
      this.undoStack.push({ change, label, token })
      if (this.undoStack.length > 200) this.undoStack.shift()
      this.redoStack = []
      this.token = token
    }
    this.changed()
    return result
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null
  }

  undo(): void {
    const step = this.undoStack.pop()
    if (!step) return
    this.deck.pkg.restore(step.change.before)
    this.redoStack.push(step)
    this.token = this.undoStack[this.undoStack.length - 1]?.token ?? 0
    this.changed()
  }

  redo(): void {
    const step = this.redoStack.pop()
    if (!step) return
    this.deck.pkg.restore(step.change.after)
    this.undoStack.push(step)
    this.token = step.token
    this.changed()
  }

  /**
   * Take back the last step without leaving it to redo, when it is `token`:
   * a text box inserted and then left empty never happened.
   */
  discard(token: number): boolean {
    const step = this.undoStack[this.undoStack.length - 1]
    if (!step || step.token !== token) return false
    this.undoStack.pop()
    this.deck.pkg.restore(step.change.before)
    this.token = this.undoStack[this.undoStack.length - 1]?.token ?? 0
    this.changed()
    return true
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  /** The presentation as bytes, with the state token they hold. */
  snapshot(): { bytes: Uint8Array; token: number } {
    return { bytes: this.deck.pkg.save(), token: this.token }
  }

  /** The bytes for `token` reached the disk. */
  markSaved(token: number): void {
    this.savedToken = token
    this.changed()
  }
}
