// rbush 4 ships no types; the part CAD uses.
declare module 'rbush' {
  export type BBox = { minX: number; minY: number; maxX: number; maxY: number }
  export default class RBush<T extends BBox> {
    constructor(maxEntries?: number)
    all(): T[]
    search(bbox: BBox): T[]
    collides(bbox: BBox): boolean
    load(data: readonly T[]): this
    insert(item: T): this
    remove(item: T, equals?: (a: T, b: T) => boolean): this
    clear(): this
  }
}
