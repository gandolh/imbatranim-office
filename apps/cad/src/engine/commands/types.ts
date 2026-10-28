/**
 * Commands are generators. A command yields a prompt ("Specify next point
 * or [Undo/Close]:") and receives the answer, whichever way it came: a click
 * (snapped, ortho, polar), typed coordinates, a typed keyword, Enter. The
 * command line, the canvas and the toolbar all feed the same generator, and
 * a test can drive one with nothing but `submit("0,0")`.
 */
import type { Seg } from '../geom/seg'
import type { Vec } from '../geom/vec'
import type { Bounds } from '../model/geometry'
import type { CadDocument } from '../model/document'
import type { Entity } from '../model/types'

/** An option of a prompt: `Close`, typed as `C` (its capital letters) or in full. */
export type Keyword = { name: string; alias: string }

export const kw = (name: string, alias?: string): Keyword => ({
  name,
  alias: alias ?? (name.replace(/[^A-Z]/g, '') || name.charAt(0).toUpperCase()),
})

/** Temporary geometry drawn while a prompt waits (rubber band, moved copies). */
export type Preview = { entities?: Entity[]; segs?: Seg[] }

type PromptBase = {
  message: string
  keywords?: Keyword[]
  /** Enter on an empty line answers `none` (otherwise Enter does nothing). */
  allowNone?: boolean
}

export type Prompt =
  | (PromptBase & {
      kind: 'point'
      /** Rubber-band origin; ortho, polar and direct distance measure from it. */
      base?: Vec
      noRubber?: boolean
      preview?: (p: Vec) => Preview
      /** A typed number (or `2x`) answers `number`: ZOOM's scale factor. */
      acceptFactor?: boolean
    })
  | (PromptBase & {
      kind: 'distance' | 'angle' | 'number'
      base?: Vec
      default?: number
      preview?: (p: Vec) => Preview
    })
  | (PromptBase & { kind: 'select' })
  | (PromptBase & {
      kind: 'entity'
      /** Why an object cannot answer, or null when it can. Refused objects are passed over. */
      filter?: (e: Entity) => string | null
      /**
       * A measure in world units, lower preferred, for choosing among the
       * objects that are about equally near the pick (within `PICK_TIE` px of
       * the nearest). Without it the nearest wins. TRIM and EXTEND measure
       * the distance to an object's nearer end, so a pick at a corner takes
       * the short stub rather than the long wall beside it.
       */
      prefer?: (e: Entity, at: Vec) => number
    })
  | (PromptBase & { kind: 'text'; default?: string })
  | (PromptBase & { kind: 'keyword'; keywords: Keyword[]; default?: string })
  /** Real-time pan: dragging moves the view until Enter or Esc. */
  | (PromptBase & { kind: 'pan' })

export type Answer =
  | { kind: 'point'; p: Vec }
  | { kind: 'number'; value: number }
  | { kind: 'keyword'; name: string }
  | { kind: 'entity'; handle: string; at: Vec }
  | { kind: 'selection'; handles: string[] }
  | { kind: 'text'; value: string }
  | { kind: 'none' }

export type CommandGen = Generator<Prompt, void, Answer>

export type CommandSettings = {
  offsetDistance: number
  filletRadius: number
  textHeight: number
  circleRadius: number
}

export interface CommandContext {
  readonly doc: CadDocument
  readonly settings: CommandSettings
  /** The current selection, if any, taken (and cleared) by a command that edits objects. */
  takeSelection(): string[] | null
  /** A line in the command history. */
  message(text: string): void
  /** Segments of an entity in world coordinates. */
  segsOf(e: Entity): Seg[]
  /** Visible, unlocked entities whose bounds touch the box (for cutting and boundary edges). */
  entitiesIn(box: Bounds): Entity[]
  zoomExtents(): void
  zoomWindow(a: Vec, b: Vec): void
  zoomBy(factor: number): void
  zoomPrevious(): boolean
  openLayerDialog(): void
  undo(count: number): number
  redo(): boolean
}

export type CommandFn = (ctx: CommandContext) => CommandGen

export type CommandDef = {
  name: string
  aliases: string[]
  /** For toolbar tooltips and the history. */
  label: string
  run: CommandFn
}
