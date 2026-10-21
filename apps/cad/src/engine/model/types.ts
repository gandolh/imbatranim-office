/**
 * The drawing model. Entities are immutable values keyed by their DXF handle:
 * an edit replaces an entity with a new object, which is what makes undo a
 * list of (before, after) pairs and lets the renderer cache by identity.
 */
import type { Vec } from '../geom/vec'

/** AutoCAD Color Index: 1–255 a colour, 256 ByLayer, 0 ByBlock. */
export const BYLAYER = 256
export const BYBLOCK = 0

export type EntityProps = {
  handle: string
  layer: string
  /** ACI 0–256 (see {@link BYLAYER}). */
  color: number
  /** A true colour (0xRRGGBB) that overrides `color` when present. */
  rgb?: number
  /** Linetype name, or 'ByLayer' / 'ByBlock'. */
  linetype: string
  linetypeScale?: number
  /** Hundredths of a millimetre; -1 ByLayer, -2 ByBlock, -3 default. */
  lineweight?: number
  /** Extended data (group codes 1000–1071) exactly as read, written back with the entity. */
  xdata?: Tag[]
}

export type PolyVertex = { x: number; y: number; bulge: number }

export type LineEntity = EntityProps & { kind: 'line'; a: Vec; b: Vec }
export type CircleEntity = EntityProps & { kind: 'circle'; c: Vec; r: number }
/** Counter-clockwise from `start` to `end`, radians. */
export type ArcEntity = EntityProps & { kind: 'arc'; c: Vec; r: number; start: number; end: number }
export type PolylineEntity = EntityProps & {
  kind: 'polyline'
  vertices: PolyVertex[]
  closed: boolean
  /** Constant width, 0 for a hairline. */
  width: number
}
export type TextEntity = EntityProps & {
  kind: 'text'
  /** The first alignment point (group 10). */
  position: Vec
  height: number
  /** Radians. */
  rotation: number
  value: string
  style: string
  /** DXF 72: 0 left, 1 center, 2 right, 3 aligned, 4 middle, 5 fit. */
  halign: number
  /** DXF 73: 0 baseline, 1 bottom, 2 middle, 3 top. */
  valign: number
  /** The second alignment point (group 11), used when not left/baseline. */
  alignPoint?: Vec
  widthFactor: number
}
export type MTextEntity = EntityProps & {
  kind: 'mtext'
  position: Vec
  height: number
  /** Reference rectangle width; 0 means no wrapping. */
  width: number
  /** 1–9: top-left … bottom-right. */
  attachment: number
  rotation: number
  /** Raw MTEXT string, formatting codes included. */
  value: string
  style: string
}
export type InsertEntity = EntityProps & {
  kind: 'insert'
  block: string
  position: Vec
  sx: number
  sy: number
  rotation: number
  /** ATTRIB values, drawn as text in world coordinates. */
  attribs: AttribText[]
}
/** An INSERT's attribute: a text with the tag it fills. */
export type AttribText = TextEntity & { tag: string; hidden: boolean }
export type EllipseEntity = EntityProps & {
  kind: 'ellipse'
  c: Vec
  /** The major axis end point, relative to the centre. */
  major: Vec
  ratio: number
  /** Parameters (radians), counter-clockwise. 0..2π is a full ellipse. */
  start: number
  end: number
}
export type PointEntity = EntityProps & { kind: 'point'; p: Vec }

/** A DXF group code and its value, as read from the file. */
export type Tag = readonly [code: number, value: string]

/**
 * Geometry that is drawn but not modelled. For a DIMENSION or ACAD_TABLE the
 * picture is its anonymous block; for a HATCH, its boundary loops.
 */
export type PreviewPrim =
  | { kind: 'poly'; pts: Vec[]; closed: boolean; fill?: boolean }
  | { kind: 'block'; block: string }

/**
 * An entity this version cannot edit (DIMENSION, HATCH, LEADER, SPLINE,
 * ACAD_TABLE, SOLID…). It keeps every group code it was read with and is
 * written back unchanged; it can be erased or moved to another layer.
 */
export type ForeignEntity = EntityProps & {
  kind: 'foreign'
  type: string
  tags: Tag[]
  preview: PreviewPrim[]
  /** True when it came from paper space (group 67): kept, never drawn. */
  paperSpace: boolean
}

export type Entity =
  | LineEntity
  | CircleEntity
  | ArcEntity
  | PolylineEntity
  | TextEntity
  | MTextEntity
  | InsertEntity
  | EllipseEntity
  | PointEntity
  | ForeignEntity

export type EntityKind = Entity['kind']

/** Entity geometry without the shared properties, for creating new ones. */
export type EntityShape = Entity extends infer E
  ? E extends Entity
    ? Omit<E, keyof EntityProps>
    : never
  : never

export type Layer = {
  name: string
  /** ACI 1–255. */
  color: number
  rgb?: number
  linetype: string
  lineweight: number
  on: boolean
  frozen: boolean
  locked: boolean
}

export type Linetype = {
  name: string
  description: string
  /** Dash lengths in drawing units: positive dash, negative gap, 0 dot. */
  pattern: number[]
}

export type Block = {
  name: string
  base: Vec
  /** DXF 70 flags (1 anonymous, 4 xref…). */
  flags: number
  entities: Entity[]
}

export type UnitSystem = 'decimal' | 'architectural' | 'metric'
/** For metric drawings: what one drawing unit is. */
export type MetricUnit = 'mm' | 'cm' | 'm'

export type Units = {
  system: UnitSystem
  /** Decimal places shown (decimal and metric). */
  precision: number
  metricUnit: MetricUnit
}

export const DEFAULT_UNITS: Units = { system: 'decimal', precision: 4, metricUnit: 'mm' }
