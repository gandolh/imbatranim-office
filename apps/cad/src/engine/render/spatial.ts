/**
 * An R-tree over the entities' bounds (rbush), kept in step with the
 * document. Rendering culls with it, and hit tests and snaps ask it for the
 * few entities near the cursor instead of walking the whole drawing.
 */
import RBush from 'rbush'
import type { Bounds } from '../model/geometry'
import { entityBounds, isEmptyBounds } from '../model/geometry'
import type { CadDocument, ChangeSet } from '../model/document'
import type { Entity } from '../model/types'

type Item = Bounds & { handle: string }

export class SpatialIndex {
  private tree = new RBush<Item>(16)
  private items = new Map<string, Item>()
  private readonly doc: CadDocument
  private unsubscribe: () => void

  constructor(doc: CadDocument) {
    this.doc = doc
    this.rebuild()
    this.unsubscribe = doc.subscribe((c) => this.update(c))
  }

  dispose(): void {
    this.unsubscribe()
  }

  private itemFor(e: Entity): Item | null {
    if (e.kind === 'foreign' && e.paperSpace) return null
    const b = entityBounds(e, this.doc.getBlock)
    if (isEmptyBounds(b)) return null
    return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, handle: e.handle }
  }

  rebuild(): void {
    this.items.clear()
    const list: Item[] = []
    for (const e of this.doc.entities.values()) {
      const item = this.itemFor(e)
      if (!item) continue
      this.items.set(e.handle, item)
      list.push(item)
    }
    this.tree.clear()
    this.tree.load(list)
  }

  private update(c: ChangeSet): void {
    if (c.reset) return this.rebuild()
    for (const h of c.removed) this.drop(h)
    for (const e of c.put) {
      this.drop(e.handle)
      const item = this.itemFor(e)
      if (item) {
        this.items.set(e.handle, item)
        this.tree.insert(item)
      }
    }
  }

  private drop(handle: string): void {
    const old = this.items.get(handle)
    if (!old) return
    this.tree.remove(old)
    this.items.delete(handle)
  }

  /** Handles whose bounds touch the box. */
  search(box: Bounds): string[] {
    return this.tree.search(box).map((i) => i.handle)
  }

  bounds(handle: string): Bounds | undefined {
    return this.items.get(handle)
  }

  /** The bounds of everything (model space), or null for an empty drawing. */
  extents(): Bounds | null {
    if (this.items.size === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const i of this.items.values()) {
      if (i.minX < minX) minX = i.minX
      if (i.minY < minY) minY = i.minY
      if (i.maxX > maxX) maxX = i.maxX
      if (i.maxY > maxY) maxY = i.maxY
    }
    return { minX, minY, maxX, maxY }
  }
}
