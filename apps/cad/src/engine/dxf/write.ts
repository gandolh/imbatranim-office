/**
 * The drawing model → DXF (AutoCAD 2007, AC1021) through @tarikjabiri/dxf.
 * The library writes the skeleton (header, tables, block records, objects)
 * and the entities CAD models. Foreign entities go out with the group codes
 * they were read with, through {@link RawEntity}: only their handle, their
 * owner and their pointers to objects that are not written are replaced.
 *
 * Handles are renumbered on every save (the library numbers everything);
 * the drawing keeps its own handles until it is reopened.
 */
import {
  Arc,
  Attrib,
  Circle,
  DxfWriter,
  Ellipse,
  Insert,
  Line,
  LWPolyline,
  MText,
  Point,
  SeqEnd,
  Text,
  type DxfBlock,
  type Dxfier,
} from '@tarikjabiri/dxf'
import { isEmptyBounds, entityBounds, unionBounds, EMPTY_BOUNDS } from '../model/geometry'
import type { CadDocument } from '../model/document'
import type { Entity, ForeignEntity, Tag, TextEntity } from '../model/types'
import { unitsToHeader } from '../model/units'
import { toDegrees } from '../geom/vec'

export type WriteReport = {
  entities: number
  /** Foreign entities written back as read, by type. */
  kept: Record<string, number>
  /** Foreign entities written in another form (a table as a block reference), by type. */
  converted: Record<string, number>
  /** Foreign entities CAD cannot write, by type. */
  dropped: Record<string, number>
}

/** Types written back from their raw group codes. Anything else needs a CLASS record or object data CAD does not keep. */
const RAW_TYPES = new Set([
  'LINE',
  'CIRCLE',
  'ARC',
  'LWPOLYLINE',
  'POLYLINE',
  'TEXT',
  'MTEXT',
  'INSERT',
  'ELLIPSE',
  'POINT',
  'DIMENSION',
  'HATCH',
  'LEADER',
  'SPLINE',
  'SOLID',
  'TRACE',
  '3DFACE',
  'RAY',
  'XLINE',
  'ATTDEF',
  'SHAPE',
  'TOLERANCE',
])

/** Subclass markers for R12 records, which have none: AcDbEntity, then these before the geometry. */
const R12_MARKERS: Record<string, string[]> = {
  LINE: ['AcDbLine'],
  CIRCLE: ['AcDbCircle'],
  ARC: ['AcDbCircle'],
  SOLID: ['AcDbTrace'],
  TRACE: ['AcDbTrace'],
  '3DFACE': ['AcDbFace'],
  POINT: ['AcDbPoint'],
  TEXT: ['AcDbText'],
}

/** Codes of the AcDbEntity part of a record (they go before the first subclass of the entity). */
const ENTITY_PART = new Set([8, 6, 62, 420, 430, 440, 370, 48, 60, 67, 284, 347, 348, 380, 390])

type WriterEntity = {
  type: string
  handle: string
  ownerBlockRecord?: string
  inPaperSpace: boolean
  layerName?: string
  lineType?: string
  colorNumber?: number
  trueColor?: string
  lineTypeScale?: number
  visible?: boolean
  subclassMarker?: string
  dxfy(dx: Dxfier): void
  dxfyChild(dx: Dxfier): void
}

/** Split flattened tags back into a parent record and its `0 TYPE`-headed children. */
function splitRecords(type: string, tags: readonly Tag[]): { type: string; tags: Tag[] }[] {
  const out: { type: string; tags: Tag[] }[] = [{ type, tags: [] }]
  for (const t of tags) {
    if (t[0] === 0) out.push({ type: t[1].trim(), tags: [] })
    else out[out.length - 1].tags.push(t)
  }
  return out
}

/**
 * The body of a raw record for output: no handle, owner, reactors, extension
 * dictionary or pointers to objects that are not written; layer replaced.
 */
function cleanBody(type: string, tags: readonly Tag[], layer: string | null): Tag[] {
  const out: Tag[] = []
  let inGroup = false
  let ownerSeen = false
  let hatchSources = false
  for (let i = 0; i < tags.length; i++) {
    const [code, value] = tags[i]
    if (code === 102) {
      inGroup = value.trim().startsWith('{')
      continue
    }
    if (inGroup) continue
    if (code === 5) continue
    if (code === 330 && !ownerSeen && !hatchSources) {
      ownerSeen = true
      continue
    }
    if (code === 97 && type === 'HATCH' && tags[i + 1]?.[0] === 330) {
      // Source boundary objects of an associative hatch: their handles go with them.
      out.push([97, '0'])
      hatchSources = true
      continue
    }
    if (hatchSources && code === 330) continue
    if (hatchSources && code !== 330) hatchSources = false
    if (code === 71 && type === 'HATCH') {
      out.push([71, '0'])
      continue
    }
    if (code >= 330 && code <= 369) continue
    if (code === 8 && layer !== null) {
      out.push([8, layer])
      continue
    }
    out.push([code, value])
  }
  if (!out.some((t) => t[0] === 100)) {
    const markers = R12_MARKERS[type]
    if (!markers) return out
    const head = out.filter((t) => ENTITY_PART.has(t[0]))
    const rest = out.filter((t) => !ENTITY_PART.has(t[0]))
    return [[100, 'AcDbEntity'], ...head, ...markers.map((m): Tag => [100, m]), ...rest]
  }
  return out
}

/** A writer entity that prints prepared group codes. */
class RawEntity extends Point {
  readonly rawType: string
  readonly body: Tag[]
  constructor(type: string, body: Tag[]) {
    super(0, 0, 0)
    this.rawType = type
    this.body = body
  }
  dxfy(dx: Dxfier): void {
    dx.type(this.rawType)
    dx.handle(this.handle)
    dx.push(330, this.ownerBlockRecord)
    for (const [code, value] of this.body) dx.push(code, value)
  }
}

/**
 * Extended data goes out exactly as it was read. (The library's ExtendedData
 * drops the last character of every string and wraps each application's data
 * in an extra 1002 list, so it is not used.)
 */
function registerXData(xdata: readonly Tag[] | undefined, appIds: Set<string>): void {
  for (const [code, value] of xdata ?? []) if (code === 1001) appIds.add(value.trim())
}

/** The library has no lineweight on entities: print the common part ourselves, with group 370. */
function withEntityProps(ent: WriterEntity, e: Entity, appIds: Set<string>): void {
  ent.layerName = e.layer
  ent.colorNumber = e.color === 256 ? undefined : e.color
  ent.trueColor = e.rgb !== undefined ? String(e.rgb) : undefined
  ent.lineType = e.linetype === 'ByLayer' ? undefined : e.linetype
  ent.lineTypeScale = e.linetypeScale
  const lineweight = e.lineweight
  const xdata = e.xdata
  ent.dxfy = function dxfy(this: WriterEntity, dx: Dxfier) {
    dx.type(this.type)
    dx.handle(this.handle)
    dx.push(330, this.ownerBlockRecord)
    dx.subclassMarker('AcDbEntity')
    if (this.inPaperSpace) dx.push(67, 1)
    dx.layerName(this.layerName || '0')
    dx.lineType(this.lineType)
    dx.colorNumber(this.colorNumber)
    dx.push(420, this.trueColor)
    if (lineweight !== undefined && lineweight !== -1) dx.push(370, lineweight)
    dx.push(48, this.lineTypeScale)
    dx.subclassMarker(this.subclassMarker)
    this.dxfyChild(dx)
    for (const [code, value] of xdata ?? []) dx.push(code, value)
  }
  registerXData(xdata, appIds)
}

const p3 = (p: { x: number; y: number }) => ({ x: p.x, y: p.y, z: 0 })

function textOptions(t: TextEntity) {
  return {
    rotation: t.rotation !== 0 ? toDegrees(t.rotation) : undefined,
    horizontalAlignment: t.halign !== 0 ? t.halign : undefined,
    verticalAlignment: t.valign !== 0 ? t.valign : undefined,
    secondAlignmentPoint:
      (t.halign !== 0 || t.valign !== 0) && t.alignPoint ? p3(t.alignPoint) : undefined,
    relativeXScaleFactor: t.widthFactor !== 1 ? t.widthFactor : undefined,
  }
}

/** MTEXT longer than 250 characters goes out in 250-character group 3 chunks, the rest in group 1. */
function mtextChunks(value: string): { chunks: string[]; last: string } {
  const chunks: string[] = []
  let rest = value.replace(/\r?\n/g, '\\P')
  while (rest.length > 250) {
    chunks.push(rest.slice(0, 250))
    rest = rest.slice(250)
  }
  return { chunks, last: rest }
}

type Ctx = {
  appIds: Set<string>
  textStyles: Set<string>
  dimStyles: Set<string>
  report: WriteReport
  /** Model or paper space, or the block being written. */
  target: DxfBlock
  paper: DxfBlock
}

function writeEntity(e: Entity, ctx: Ctx, count: boolean): void {
  const add = <T>(ent: T): T => {
    const w = ent as unknown as WriterEntity
    withEntityProps(w, e, ctx.appIds)
    ctx.target.addEntity(ent as unknown as Line)
    if (count) ctx.report.entities++
    return ent
  }
  switch (e.kind) {
    case 'line':
      add(new Line(p3(e.a), p3(e.b)))
      return
    case 'circle':
      add(new Circle(p3(e.c), e.r))
      return
    case 'arc':
      add(new Arc(p3(e.c), e.r, toDegrees(e.start), toDegrees(e.end)))
      return
    case 'point':
      add(new Point(e.p.x, e.p.y, 0))
      return
    case 'polyline':
      add(
        new LWPolyline(
          e.vertices.map((v) => ({
            point: { x: v.x, y: v.y },
            bulge: v.bulge !== 0 ? v.bulge : undefined,
          })),
          { flags: e.closed ? 1 : 0, constantWidth: e.width }
        )
      )
      return
    case 'ellipse':
      add(new Ellipse(p3(e.c), p3(e.major), e.ratio, e.start, e.end))
      return
    case 'text': {
      ctx.textStyles.add(e.style)
      const t = add(
        new Text(p3(e.position), e.height, e.value.replace(/\r?\n/g, ' '), textOptions(e))
      )
      t.textStyle = e.style
      return
    }
    case 'mtext': {
      ctx.textStyles.add(e.style)
      const m = add(
        new MText(p3(e.position), e.height, '', {
          rotation: e.rotation !== 0 ? toDegrees(e.rotation) : undefined,
          attachmentPoint: e.attachment,
          width: e.width > 0 ? e.width : undefined,
        })
      )
      m.textStyle = e.style
      const { chunks, last } = mtextChunks(e.value)
      const w = m as unknown as WriterEntity
      w.dxfyChild = function dxfyChild(dx: Dxfier) {
        dx.point3d(m.position)
        dx.push(40, m.height)
        dx.push(41, m.width)
        dx.push(71, m.attachmentPoint)
        for (const c of chunks) dx.push(3, c)
        dx.push(1, last)
        dx.push(50, m.rotation)
        dx.push(7, m.textStyle)
      }
      return
    }
    case 'insert': {
      const ins = add(
        new Insert(e.block, p3(e.position), {
          scaleFactor: { x: e.sx, y: e.sy, z: 1 },
          rotationAngle: toDegrees(e.rotation),
        })
      )
      if (e.attribs.length > 0) {
        ins.attributesFollowFlag = 1
        for (const a of e.attribs) {
          ctx.textStyles.add(a.style)
          const at = new Attrib(p3(a.position), a.height, a.tag, a.value, textOptions(a))
          at.textStyle = a.style
          const w = at as unknown as WriterEntity
          withEntityProps(w, a, ctx.appIds)
          ctx.target.addEntity(at)
          w.ownerBlockRecord = ins.handle
          // The library writes every attribute visible (flags 0).
          w.dxfyChild = function dxfyChild(dx: Dxfier) {
            dx.point3d(at.position)
            dx.push(40, at.height)
            dx.primaryText(at.value)
            dx.push(50, at.rotation)
            dx.push(41, at.relativeXScaleFactor)
            dx.textStyle(at.textStyle)
            dx.push(72, at.horizontalAlignment)
            dx.point3d(at.secondAlignmentPoint, 1)
            dx.subclassMarker('AcDbAttribute')
            dx.push(280, 0)
            dx.push(2, at.tag)
            dx.push(70, a.hidden ? 1 : 0)
            dx.push(74, at.verticalAlignment)
          }
        }
        const end = new SeqEnd()
        ctx.target.addEntity(end)
        ;(end as unknown as WriterEntity).layerName = e.layer
        ;(end as unknown as WriterEntity).ownerBlockRecord = ins.handle
      }
      return
    }
    case 'foreign':
      writeForeign(e, ctx, count)
      return
  }
}

function writeForeign(e: ForeignEntity, ctx: Ctx, count: boolean): void {
  const tally = (bucket: Record<string, number>) => {
    if (count) bucket[e.type] = (bucket[e.type] ?? 0) + 1
  }
  if (e.type === 'ACAD_TABLE') {
    const block = e.preview.find((p) => p.kind === 'block')
    if (block && block.kind === 'block') {
      const ins = new Insert(block.block, { x: 0, y: 0, z: 0 })
      withEntityProps(ins as unknown as WriterEntity, e, ctx.appIds)
      ctx.target.addEntity(ins)
      if (count) ctx.report.entities++
      tally(ctx.report.converted)
    } else tally(ctx.report.dropped)
    return
  }
  if (!RAW_TYPES.has(e.type)) {
    tally(ctx.report.dropped)
    return
  }
  const records = splitRecords(e.type, e.tags)
  const head = cleanBody(e.type, records[0].tags, e.layer)
  if (!head.some((t) => t[0] === 100)) {
    // An R12 record of a kind with no known subclass layout.
    tally(ctx.report.dropped)
    return
  }
  for (const t of head) {
    if (t[0] === 3 && (e.type === 'DIMENSION' || e.type === 'LEADER' || e.type === 'TOLERANCE'))
      ctx.dimStyles.add(t[1].trim())
    if (t[0] === 7 && (e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'ATTDEF'))
      ctx.textStyles.add(t[1].trim())
  }
  for (let i = head.findIndex((t) => t[0] === 1001); i >= 0 && i < head.length; i++) {
    if (head[i][0] === 1001) ctx.appIds.add(head[i][1].trim())
  }
  const target = e.paperSpace ? ctx.paper : ctx.target
  const parent = new RawEntity(e.type, head)
  target.addEntity(parent)
  for (const child of records.slice(1)) {
    const body = cleanBody(child.type, child.tags, e.layer)
    const c = new RawEntity(child.type, body)
    target.addEntity(c)
    c.ownerBlockRecord = parent.handle
  }
  if (count) ctx.report.entities++
  tally(ctx.report.kept)
}

/** The drawing as DXF text, and what happened to the entities CAD does not model. */
export function writeDxf(doc: CadDocument): { text: string; report: WriteReport } {
  const dxf = new DxfWriter()
  const report: WriteReport = { entities: 0, kept: {}, converted: {}, dropped: {} }
  const tables = dxf.document.tables

  const header = unitsToHeader(doc.units)
  dxf.setVariable('$INSUNITS', { 70: header.insunits })
  dxf.setVariable('$LUNITS', { 70: header.lunits })
  dxf.setVariable('$LUPREC', { 70: header.luprec })

  for (const lt of doc.linetypes.values()) {
    if (/^(continuous|bylayer|byblock)$/i.test(lt.name)) continue
    if (!tables.ltypeTable.exist(lt.name)) tables.addLType(lt.name, lt.description, lt.pattern)
  }
  const knownLinetype = (name: string) =>
    /^(continuous|bylayer|byblock)$/i.test(name) || tables.ltypeTable.exist(name)

  for (const l of doc.layers.values()) {
    const flags = (l.frozen ? 1 : 0) | (l.locked ? 4 : 0)
    const lt = knownLinetype(l.linetype)
      ? /^continuous$/i.test(l.linetype)
        ? 'Continuous'
        : l.linetype
      : 'Continuous'
    let layer = tables.layer(l.name)
    if (!layer) layer = tables.addLayer(l.name, l.color, lt, flags)
    else {
      layer.colorNumber = l.color
      layer.lineType = lt
      layer.flags = flags
    }
    if (!l.on) layer.colorNumber = -Math.abs(l.color)
    if (l.rgb !== undefined) layer.trueColor = l.rgb
    const lw = l.lineweight
    const record = layer
    record.dxfy = function dxfy(dx: Dxfier) {
      dx.type('LAYER')
      dx.handle(record.handle)
      dx.push(330, (record as unknown as { ownerObjectHandle?: string }).ownerObjectHandle)
      dx.subclassMarker('AcDbSymbolTableRecord')
      dx.subclassMarker('AcDbLayerTableRecord')
      dx.name(record.name)
      dx.push(70, record.flags)
      dx.colorNumber(record.colorNumber)
      dx.push(420, record.trueColor)
      dx.lineType(record.lineType)
      dx.push(370, lw)
      dx.push(390, 0)
    }
  }
  dxf.setCurrentLayerName(doc.currentLayer)

  const appIds = new Set<string>()
  const textStyles = new Set<string>(doc.textStyles)
  const dimStyles = new Set<string>()
  const base: Omit<Ctx, 'target'> = {
    appIds,
    textStyles,
    dimStyles,
    report,
    paper: dxf.document.paperSpace,
  }

  for (const b of doc.blocks.values()) {
    const block = dxf.document.blocks.addBlock(b.name, dxf.document.objects, false)
    block.basePoint = p3(b.base)
    block.flags = b.flags & 0b11111
    for (const child of b.entities) writeEntity(child, { ...base, target: block }, false)
  }
  for (const e of doc.entities.values())
    writeEntity(e, { ...base, target: dxf.document.modelSpace }, true)

  for (const name of appIds) {
    if (!tables.appIdTable.records.some((r) => r.name.toUpperCase() === name.toUpperCase()))
      tables.addAppId(name)
  }
  for (const name of textStyles) {
    if (!tables.styleTable.records.some((r) => r.name.toUpperCase() === name.toUpperCase()))
      tables.addStyle(name)
  }
  for (const name of dimStyles) {
    if (!tables.dimStyleTable.records.some((r) => r.name.toUpperCase() === name.toUpperCase()))
      tables.addDimStyle(name)
  }

  let ext = EMPTY_BOUNDS
  for (const e of doc.entities.values()) {
    if (e.kind === 'foreign' && e.paperSpace) continue
    ext = unionBounds(ext, entityBounds(e, doc.getBlock))
  }
  if (!isEmptyBounds(ext)) {
    dxf.setVariable('$EXTMIN', { 10: ext.minX, 20: ext.minY, 30: 0 })
    dxf.setVariable('$EXTMAX', { 10: ext.maxX, 20: ext.maxY, 30: 0 })
  }
  return { text: dxf.stringify(), report }
}

/** The drawing as DXF bytes (UTF-8, as AC1021 files are). */
export function writeDxfBytes(doc: CadDocument): { bytes: Uint8Array; report: WriteReport } {
  const { text, report } = writeDxf(doc)
  return { bytes: new TextEncoder().encode(`${text}\n`), report }
}
