/**
 * DXF → the drawing model. dxf-viewer's parser reads the entities; the raw
 * pass in tags.ts keeps what it drops. Each raw entity record is matched to
 * the parser's entity with the same handle (type and occurrence in files
 * without handles), so an entity the parser skipped (LEADER, ACAD_TABLE)
 * still arrives, as a foreign entity with its own group codes.
 */
import DxfParser, { type ParsedEntity, type ParsedPoint } from 'dxf-viewer/src/parser/DxfParser.js'
import { bulgeSeg } from '../geom/seg'
import { normAngle, toRadians, type Vec } from '../geom/vec'
import { CadDocument, CONTINUOUS, DEFAULT_LAYER } from '../model/document'
import type {
  AttribText,
  Block,
  Entity,
  EntityProps,
  Layer,
  Linetype,
  PreviewPrim,
  Tag,
  TextEntity,
} from '../model/types'
import { BYLAYER } from '../model/types'
import { unitsFromHeader } from '../model/units'
import {
  decodeDxf,
  rawSections,
  tagNumber,
  tagPoints,
  tagValue,
  tokenize,
  type RawEntity,
} from './tags'

export type ReadReport = {
  /** Entities read into model space, by DXF type. */
  counts: Record<string, number>
  /** Of those, the ones kept as foreign (drawn, written back, not editable), by type. */
  foreign: Record<string, number>
  version: string | null
}

export type ReadResult = { doc: CadDocument; report: ReadReport }

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const pt = (v: unknown): Vec => {
  const p = v as ParsedPoint | undefined
  return { x: num(p?.x), y: num(p?.y) }
}

/** Extrusion (0,0,-1) flips an entity's object coordinates: x → -x in world. */
function isFlipped(tags: readonly Tag[]): boolean {
  const z = tagNumber(tags, 230)
  return z !== undefined && z < 0
}
function hasOddExtrusion(tags: readonly Tag[]): boolean {
  const x = tagNumber(tags, 210) ?? 0
  const y = tagNumber(tags, 220) ?? 0
  return Math.abs(x) > 1e-9 || Math.abs(y) > 1e-9
}

function props(p: ParsedEntity, raw: RawEntity | undefined, handle: string): EntityProps {
  const tags = raw?.tags ?? []
  const out: EntityProps = {
    handle,
    layer: str(p.layer, tagValue(tags, 8)?.trim() ?? '0') || '0',
    color: p.colorIndex !== undefined ? num(p.colorIndex, BYLAYER) : BYLAYER,
    linetype: str(p.lineType, 'ByLayer') || 'ByLayer',
  }
  const tc = tagNumber(tags, 420)
  if (tc !== undefined) out.rgb = tc & 0xffffff
  if (p.lineTypeScale !== undefined && p.lineTypeScale !== 1)
    out.linetypeScale = num(p.lineTypeScale, 1)
  if (p.lineweight !== undefined) out.lineweight = num(p.lineweight, -1)
  const x = tags.findIndex((t) => t[0] === 1001)
  if (x >= 0) out.xdata = tags.slice(x).filter((t) => t[0] >= 1000)
  if (/^bylayer$/i.test(out.linetype)) out.linetype = 'ByLayer'
  if (/^byblock$/i.test(out.linetype)) out.linetype = 'ByBlock'
  return out
}

function textEntity(p: ParsedEntity, base: EntityProps): TextEntity {
  const position = pt(p.startPoint)
  const halign = num(p.halign)
  const valign = num(p.valign)
  return {
    ...base,
    kind: 'text',
    position,
    height: num(p.textHeight, 1),
    rotation: normAngle(toRadians(num(p.rotation))),
    value: str(p.text),
    style: str(p.styleName, 'Standard') || 'Standard',
    halign,
    valign,
    alignPoint: p.endPoint ? pt(p.endPoint) : undefined,
    widthFactor: num(p.xScale, 1) || 1,
  }
}

function flipX(v: Vec): Vec {
  return { x: -v.x, y: v.y }
}

function hatchPreview(p: ParsedEntity): PreviewPrim[] {
  const loops = (p.boundaryLoops as unknown[] | undefined) ?? []
  const solid = p.isSolid === true
  const out: PreviewPrim[] = []
  for (const loop of loops as {
    polyline?: { vertices: ParsedPoint[]; isClosed?: unknown }
    edges?: Record<string, unknown>[]
  }[]) {
    const pts: Vec[] = []
    if (loop.polyline) {
      const v = loop.polyline.vertices
      for (let i = 0; i < v.length; i++) {
        const a = pt(v[i])
        const b = pt(v[(i + 1) % v.length])
        const bulge = num(v[i].bulge)
        pts.push(a)
        if (bulge !== 0 && i < v.length) {
          const seg = bulgeSeg(a, b, bulge)
          if (seg.kind === 'arc')
            pts.push(...arcPoints(seg.c, seg.r, seg.start, seg.end, bulge < 0).slice(1, -1))
        }
      }
    }
    for (const e of loop.edges ?? []) {
      const type = num(e.type)
      if (type === 1) {
        pts.push(pt(e.start), pt(e.end))
      } else if (type === 2) {
        const c = pt(e.start)
        const r = num(e.radius)
        const ccw = e.isCcw === undefined || e.isCcw === 1 || e.isCcw === true
        const s = num(e.startAngle)
        const en = num(e.endAngle)
        // Clockwise edges store their angles mirrored.
        pts.push(...(ccw ? arcPoints(c, r, s, en, false) : arcPoints(c, r, -en, -s, true)))
      } else if (type === 3) {
        const c = pt(e.start)
        const major = pt(e.end)
        const ratio = num(e.radius, 1)
        const s = num(e.startAngle)
        const en = num(e.endAngle, Math.PI * 2)
        const n = 48
        const sweep = normAngle(en - s) || Math.PI * 2
        for (let i = 0; i <= n; i++) {
          const t = s + (sweep * i) / n
          pts.push({
            x: c.x + major.x * Math.cos(t) - major.y * ratio * Math.sin(t),
            y: c.y + major.y * Math.cos(t) + major.x * ratio * Math.sin(t),
          })
        }
      } else if (type === 4) {
        const cps =
          (e.controlPoints as ParsedPoint[] | undefined) ??
          (e.fitPoints as ParsedPoint[] | undefined) ??
          []
        pts.push(...cps.map(pt))
      }
    }
    if (pts.length > 1) out.push({ kind: 'poly', pts, closed: true, fill: solid })
  }
  return out
}

function arcPoints(c: Vec, r: number, start: number, end: number, reversed: boolean): Vec[] {
  const sweep = normAngle(end - start) || Math.PI * 2
  const n = Math.max(4, Math.ceil((sweep / (Math.PI * 2)) * 48))
  const pts: Vec[] = []
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  }
  return reversed ? pts.reverse() : pts
}

/** A uniform B-spline/fit-point curve preview: the control polygon, smoothed by de Boor where knots allow. */
function splinePreview(p: ParsedEntity): PreviewPrim[] {
  const cps = ((p.controlPoints as ParsedPoint[] | undefined) ?? []).map(pt)
  const fits = ((p.fitPoints as ParsedPoint[] | undefined) ?? []).map(pt)
  const knots = (p.knotValues as number[] | undefined) ?? []
  const degree = num(p.degreeOfSplineCurve, 3)
  if (cps.length > degree && knots.length === cps.length + degree + 1) {
    const pts: Vec[] = []
    const t0 = knots[degree]
    const t1 = knots[cps.length]
    const n = Math.max(16, cps.length * 8)
    for (let i = 0; i <= n; i++) pts.push(deBoor(degree, cps, knots, t0 + ((t1 - t0) * i) / n))
    return [{ kind: 'poly', pts, closed: false }]
  }
  const list = fits.length > 1 ? fits : cps
  return list.length > 1 ? [{ kind: 'poly', pts: list, closed: p.closed === true }] : []
}

function deBoor(k: number, cps: Vec[], t: number[], x: number): Vec {
  let s = k
  while (s < cps.length - 1 && x >= t[s + 1]) s++
  const d = cps.slice(s - k, s + 1).map((p) => ({ x: p.x, y: p.y }))
  for (let r = 1; r <= k; r++) {
    for (let j = k; j >= r; j--) {
      const i = j + s - k
      const den = t[i + k + 1 - r] - t[i]
      const a = den === 0 ? 0 : (x - t[i]) / den
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y }
    }
  }
  return d[k]
}

function foreignPreview(type: string, p: ParsedEntity | undefined, raw: RawEntity): PreviewPrim[] {
  switch (type) {
    case 'DIMENSION':
    case 'ACAD_TABLE': {
      const block = p && typeof p.block === 'string' ? p.block : tagValue(raw.tags, 2)?.trim()
      return block ? [{ kind: 'block', block }] : []
    }
    case 'HATCH':
      return p ? hatchPreview(p) : []
    case 'SPLINE':
      return p ? splinePreview(p) : []
    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      const pts = [10, 11, 12, 13].map((c) => ({
        x: tagNumber(raw.tags, c) ?? 0,
        y: tagNumber(raw.tags, c + 10) ?? 0,
      }))
      // SOLID's third and fourth corners are swapped relative to the outline.
      const outline = type === '3DFACE' ? pts : [pts[0], pts[1], pts[3], pts[2]]
      return [{ kind: 'poly', pts: outline, closed: true, fill: type !== '3DFACE' }]
    }
    case 'LEADER': {
      const pts = tagPoints(raw.tags, 10)
      return pts.length > 1 ? [{ kind: 'poly', pts, closed: false }] : []
    }
    case 'POLYLINE': {
      // 3D polylines and meshes: their vertices, flattened, for the eye only.
      const pts = raw.children
        .filter((c) => c.type === 'VERTEX')
        .map((v) => ({ x: tagNumber(v.tags, 10) ?? 0, y: tagNumber(v.tags, 20) ?? 0 }))
      return pts.length > 1
        ? [{ kind: 'poly', pts, closed: ((tagNumber(raw.tags, 70) ?? 0) & 1) === 1 }]
        : []
    }
    default:
      return []
  }
}

/** Every tag of a raw record, children (VERTEX, ATTRIB, SEQEND) included, re-headed with their `0 TYPE`. */
function flatTags(raw: RawEntity): Tag[] {
  const out: Tag[] = [...raw.tags]
  for (const child of raw.children) {
    out.push([0, child.type], ...child.tags)
  }
  return out
}

type Ctx = { doc: { newHandle(): string }; attribs: ParsedEntity[] }

function convert(
  p: ParsedEntity | undefined,
  raw: RawEntity,
  ctx: Ctx,
  inBlock: boolean
): Entity | null {
  const type = raw.type
  const rawHandle = tagValue(raw.tags, 5)?.trim()
  const handle = rawHandle ? rawHandle.toUpperCase() : ctx.doc.newHandle()
  const base = p ? props(p, raw, handle) : props({ type }, raw, handle)
  const paperSpace = (tagNumber(raw.tags, 67) ?? 0) === 1
  const flipped = isFlipped(raw.tags)
  const odd = hasOddExtrusion(raw.tags)
  const foreign = (): Entity => ({
    ...base,
    kind: 'foreign',
    type,
    tags: flatTags(raw),
    preview: paperSpace ? [] : foreignPreview(type, p, raw),
    paperSpace,
  })
  if (!p || paperSpace || odd || (inBlock && type === 'ATTDEF')) return foreign()
  switch (type) {
    case 'LINE': {
      const v = (p.vertices as ParsedPoint[] | undefined) ?? []
      if (v.length < 2) return foreign()
      return { ...base, kind: 'line', a: pt(v[0]), b: pt(v[1]) }
    }
    case 'CIRCLE': {
      const c = pt(p.center)
      return { ...base, kind: 'circle', c: flipped ? flipX(c) : c, r: num(p.radius) }
    }
    case 'ARC': {
      const c = pt(p.center)
      // dxf-viewer returns radians.
      const s = num(p.startAngle)
      const e = num(p.endAngle)
      if (flipped)
        return {
          ...base,
          kind: 'arc',
          c: flipX(c),
          r: num(p.radius),
          start: normAngle(Math.PI - e),
          end: normAngle(Math.PI - s),
        }
      return { ...base, kind: 'arc', c, r: num(p.radius), start: normAngle(s), end: normAngle(e) }
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (type === 'POLYLINE' && (p.is3dPolyline || p.is3dPolygonMesh || p.isPolyfaceMesh))
        return foreign()
      const v = ((p.vertices as ParsedPoint[] | undefined) ?? []).map((q) => ({
        x: flipped ? -num(q.x) : num(q.x),
        y: num(q.y),
        bulge: flipped ? -num(q.bulge) : num(q.bulge),
      }))
      if (v.length === 0) return foreign()
      const width =
        type === 'LWPOLYLINE' ? (tagNumber(raw.tags, 43) ?? 0) : (tagNumber(raw.tags, 40) ?? 0)
      return { ...base, kind: 'polyline', vertices: v, closed: p.shape === true, width }
    }
    case 'TEXT': {
      if (flipped) return foreign()
      return textEntity(p, base)
    }
    case 'MTEXT': {
      if (flipped) return foreign()
      const dir = p.direction as ParsedPoint | undefined
      const rotation = dir ? Math.atan2(num(dir.y), num(dir.x)) : toRadians(num(p.rotation))
      return {
        ...base,
        kind: 'mtext',
        position: pt(p.position),
        height: num(p.height, 1),
        width: num(p.width),
        attachment: Math.min(9, Math.max(1, num(p.attachmentPoint, 1))),
        rotation: normAngle(rotation),
        value: str(p.text),
        style: str(p.styleName, 'Standard') || 'Standard',
      }
    }
    case 'INSERT': {
      // Arrays of inserts (MINSERT) stay foreign.
      if (num(p.columnCount, 1) > 1 || num(p.rowCount, 1) > 1 || flipped) return foreign()
      // The parser lists ATTRIBs as entities of their own, right after their INSERT.
      const attribs: AttribText[] = []
      for (const rawAttrib of raw.children.filter((c) => c.type === 'ATTRIB')) {
        const a = ctx.attribs.shift()
        if (!a) break
        const ah = tagValue(rawAttrib.tags, 5)?.trim().toUpperCase() ?? ctx.doc.newHandle()
        const t = textEntity(
          {
            ...a,
            styleName: a.textStyle,
            halign: a.horizontalJustification,
            valign: a.verticalJustification,
          },
          props(a, rawAttrib, ah)
        )
        attribs.push({ ...t, tag: str(a.tag), hidden: a.hidden === true })
      }
      return {
        ...base,
        kind: 'insert',
        block: str(p.name),
        position: pt(p.position),
        sx: num(p.xScale, 1) || 1,
        sy: num(p.yScale, 1) || 1,
        rotation: normAngle(toRadians(num(p.rotation))),
        attribs,
      }
    }
    case 'ELLIPSE': {
      if (flipped) return foreign()
      return {
        ...base,
        kind: 'ellipse',
        c: pt(p.center),
        major: pt(p.majorAxisEndPoint),
        ratio: num(p.axisRatio, 1),
        start: num(p.startAngle),
        end: num(p.endAngle, Math.PI * 2),
      }
    }
    case 'POINT':
      return { ...base, kind: 'point', p: pt(p.position) }
    default:
      return foreign()
  }
}

/**
 * Pair raw records with parsed entities: by handle where the file has
 * handles (a record whose handle the parser did not return stays foreign, so
 * its own group codes are what gets written back), by type and occurrence in
 * files without them.
 */
function pairUp(raws: RawEntity[], parsed: ParsedEntity[]): (ParsedEntity | undefined)[] {
  const byHandle = new Map<string, ParsedEntity>()
  const byType = new Map<string, ParsedEntity[]>()
  for (const p of parsed) {
    if (p.handle !== undefined && p.handle !== '')
      byHandle.set(`${p.type}:${String(p.handle).toUpperCase()}`, p)
    else {
      const list = byType.get(p.type) ?? []
      list.push(p)
      byType.set(p.type, list)
    }
  }
  const seen = new Map<string, number>()
  return raws.map((r) => {
    const h = tagValue(r.tags, 5)?.trim().toUpperCase()
    if (h) return byHandle.get(`${r.type}:${h}`)
    const k = seen.get(r.type) ?? 0
    seen.set(r.type, k + 1)
    return byType.get(r.type)?.[k]
  })
}

const SPACE_BLOCK = /^\*(model|paper)_space/i

export function readDxf(bytes: Uint8Array): ReadResult {
  const text = decodeDxf(bytes)
  const result = new DxfParser().parseSync(text)
  // A minimal DXF may hold an ENTITIES section and nothing else.
  const parsed = {
    tables: result?.tables ?? {},
    blocks: result?.blocks ?? {},
    entities: result?.entities ?? [],
  }
  const raw = rawSections(tokenize(text))
  const report: ReadReport = { counts: {}, foreign: {}, version: null }
  const headerNum = (name: string): number | undefined => {
    const t = raw.header.get(name)
    return t ? (tagNumber(t, 70) ?? tagNumber(t, 40) ?? tagNumber(t, 5)) : undefined
  }
  report.version = raw.header.get('$ACADVER')
    ? (tagValue(raw.header.get('$ACADVER')!, 1)?.trim() ?? null)
    : null

  // Entities without a handle (R12 files written without $HANDLING) get one above every handle in the file.
  let handleSeed = parseInt(tagValue(raw.header.get('$HANDSEED') ?? [], 5)?.trim() ?? '0', 16) || 0
  const bump = (list: RawEntity[]) => {
    for (const r of list) {
      const h = parseInt(tagValue(r.tags, 5)?.trim() ?? '', 16)
      if (Number.isFinite(h)) handleSeed = Math.max(handleSeed, h + 1)
    }
  }
  bump(raw.entities)
  for (const list of raw.blocks.values()) bump(list)
  const seedDoc = { newHandle: () => (handleSeed++).toString(16).toUpperCase() }
  const attribQueue = (list: ParsedEntity[] | undefined) =>
    (list ?? []).filter((e) => e.type === 'ATTRIB')

  // Layers: the parser's, plus linetype, lock and lineweight from the raw records.
  const layers: Layer[] = []
  for (const [name, rec] of raw.layers) {
    const pl = parsed.tables.layer?.layers[name]
    const flags = Number(rec.get(70) ?? 0)
    const color = Number(rec.get(62) ?? 7)
    const lt = rec.get(6)?.trim() || 'Continuous'
    const rgb = rec.get(420)
    layers.push({
      name,
      color: Math.abs(color) || 7,
      rgb: rgb !== undefined ? Number(rgb) & 0xffffff : undefined,
      linetype: /^continuous$/i.test(lt) ? 'Continuous' : lt,
      lineweight: rec.has(370) ? Number(rec.get(370)) : -3,
      on: pl?.visible ?? color >= 0,
      frozen: (flags & 1) === 1,
      locked: (flags & 4) === 4,
    })
  }

  const linetypes: Linetype[] = []
  for (const lt of Object.values(parsed.tables.lineType?.lineTypes ?? {})) {
    if (!lt.name || /^(bylayer|byblock|continuous)$/i.test(lt.name)) continue
    linetypes.push({ name: lt.name, description: lt.description ?? '', pattern: lt.pattern ?? [] })
  }

  const blocks: Block[] = []
  for (const [name, rawList] of raw.blocks) {
    if (SPACE_BLOCK.test(name)) continue
    const pb = parsed.blocks[name]
    const pairs = pairUp(rawList, pb?.entities ?? [])
    const entities: Entity[] = []
    const blockCtx: Ctx = { doc: seedDoc, attribs: attribQueue(pb?.entities) }
    rawList.forEach((r, i) => {
      const e = convert(pairs[i], r, blockCtx, true)
      if (e) entities.push(e)
    })
    blocks.push({ name, base: pt(pb?.position), flags: pb?.type ?? 0, entities })
  }

  const entities: Entity[] = []
  const ctx: Ctx = { doc: seedDoc, attribs: attribQueue(parsed.entities) }
  const pairs = pairUp(raw.entities, parsed.entities)
  raw.entities.forEach((r, i) => {
    const e = convert(pairs[i], r, ctx, false)
    if (!e) return
    entities.push(e)
    report.counts[r.type] = (report.counts[r.type] ?? 0) + 1
    if (e.kind === 'foreign') report.foreign[r.type] = (report.foreign[r.type] ?? 0) + 1
  })

  // Entities may name a layer the table lacks; DXF readers create it.
  const known = new Set(layers.map((l) => l.name))
  for (const e of entities) {
    if (!known.has(e.layer)) {
      known.add(e.layer)
      layers.push({ ...DEFAULT_LAYER, name: e.layer })
    }
  }

  const clayer = tagValue(raw.header.get('$CLAYER') ?? [], 8)?.trim()
  const textStyles = Object.keys(parsed.tables.style?.styles ?? {})
  const doc = new CadDocument({
    entities,
    layers,
    linetypes: [CONTINUOUS, ...linetypes],
    blocks,
    currentLayer: clayer,
    units: unitsFromHeader(headerNum('$INSUNITS'), headerNum('$LUNITS'), headerNum('$LUPREC')),
    nextHandle: handleSeed,
    textStyles: textStyles.length > 0 ? textStyles : ['Standard'],
  })
  return { doc, report }
}
