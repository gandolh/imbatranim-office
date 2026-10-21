/** MOVE, COPY, ROTATE, SCALE, MIRROR, ERASE, OFFSET, TRIM, EXTEND and FILLET. */
import { mirroring, rotation, scaling, translation, type Affine } from '../geom/affine'
import { extendCurve, fillet, isCurve, offsetCurve, trimCurve, type CurveShape } from '../geom/edit'
import type { Seg } from '../geom/seg'
import { angleFrom, dist, type Vec } from '../geom/vec'
import { entityBounds, isTransformable, transformEntity, type Bounds } from '../model/geometry'
import type { Entity } from '../model/types'
import { formatDistance } from '../model/units'
import {
  kw,
  type Answer,
  type CommandContext,
  type CommandFn,
  type CommandGen,
  type Prompt,
} from './types'

/** Past this many objects, previews show only the first ones. */
const PREVIEW_LIMIT = 400

/** The objects to work on: the current selection, or ask. */
function* selectObjects(ctx: CommandContext, editable = true): Generator<Prompt, Entity[], Answer> {
  let handles = ctx.takeSelection()
  if (!handles) {
    const a = yield { kind: 'select', message: 'Select objects:' }
    if (a.kind !== 'selection') return []
    handles = a.handles
  }
  const all = handles
    .map((h) => ctx.doc.entities.get(h))
    .filter((e): e is Entity => e !== undefined)
  if (!editable) return all
  const ok = all.filter(isTransformable)
  const skipped = all.length - ok.length
  if (skipped > 0)
    ctx.message(
      `${skipped} object${skipped === 1 ? '' : 's'} CAD cannot edit yet (dimensions, hatches…) left out.`
    )
  return ok
}

function moved(list: Entity[], m: Affine): Entity[] {
  const out: Entity[] = []
  for (const e of list.slice(0, PREVIEW_LIMIT)) {
    const t = transformEntity(e, m)
    if (t) out.push(t)
  }
  return out
}

function applyTransform(ctx: CommandContext, list: Entity[], m: Affine, copy: boolean): void {
  const out: Entity[] = []
  for (const e of list) {
    const t = transformEntity(e, m)
    if (!t) continue
    out.push(copy ? ({ ...t, handle: ctx.doc.newHandle() } as Entity) : t)
  }
  if (copy) ctx.doc.add(...out)
  else ctx.doc.replace(...out)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const MOVE: CommandFn = function* move(ctx) {
  const list = yield* selectObjects(ctx)
  if (list.length === 0) return
  const b = yield {
    kind: 'point',
    message: 'Specify base point or [Displacement] <Displacement>:',
    keywords: [kw('Displacement')],
    allowNone: true,
  }
  let base: Vec = { x: 0, y: 0 }
  if (b.kind === 'point') base = b.p
  const second = yield {
    kind: 'point',
    message:
      b.kind === 'point'
        ? 'Specify second point or <use first point as displacement>:'
        : 'Specify displacement:',
    base,
    allowNone: b.kind === 'point',
    preview: (p) => ({ entities: moved(list, translation(p.x - base.x, p.y - base.y)) }),
  }
  let d: Vec
  if (second.kind === 'point') d = { x: second.p.x - base.x, y: second.p.y - base.y }
  else if (second.kind === 'none') d = base
  else return
  applyTransform(ctx, list, translation(d.x, d.y), false)
  ctx.message(`Moved ${plural(list.length, 'object')}.`)
}

export const COPY: CommandFn = function* copy(ctx) {
  const list = yield* selectObjects(ctx)
  if (list.length === 0) return
  const b = yield { kind: 'point', message: 'Specify base point:' }
  if (b.kind !== 'point') return
  const base = b.p
  const made: string[][] = []
  for (;;) {
    const a = yield {
      kind: 'point',
      message: 'Specify second point or [Exit/Undo] <Exit>:',
      base,
      keywords: [kw('Exit'), kw('Undo')],
      allowNone: true,
      preview: (p) => ({ entities: moved(list, translation(p.x - base.x, p.y - base.y)) }),
    }
    if (a.kind === 'none' || (a.kind === 'keyword' && a.name === 'Exit')) return
    if (a.kind === 'keyword' && a.name === 'Undo') {
      const last = made.pop()
      if (last) ctx.doc.remove(...last)
      continue
    }
    if (a.kind !== 'point') continue
    const before = new Set(ctx.doc.entities.keys())
    applyTransform(ctx, list, translation(a.p.x - base.x, a.p.y - base.y), true)
    made.push([...ctx.doc.entities.keys()].filter((h) => !before.has(h)))
  }
}

export const ROTATE: CommandFn = function* rotate(ctx) {
  const list = yield* selectObjects(ctx)
  if (list.length === 0) return
  const b = yield { kind: 'point', message: 'Specify base point:' }
  if (b.kind !== 'point') return
  const base = b.p
  const a = yield {
    kind: 'angle',
    message: 'Specify rotation angle or [Reference] <0>:',
    base,
    default: 0,
    keywords: [kw('Reference')],
    preview: (p) => ({ entities: moved(list, rotation(angleFrom(base, p), base)) }),
  }
  let angle: number
  if (a.kind === 'keyword') {
    const ref = yield {
      kind: 'angle',
      message: 'Specify the reference angle <0>:',
      base,
      default: 0,
    }
    if (ref.kind !== 'number') return
    const next = yield {
      kind: 'angle',
      message: 'Specify the new angle:',
      base,
      preview: (p) => ({ entities: moved(list, rotation(angleFrom(base, p) - ref.value, base)) }),
    }
    if (next.kind !== 'number') return
    angle = next.value - ref.value
  } else if (a.kind === 'number') angle = a.value
  else return
  applyTransform(ctx, list, rotation(angle, base), false)
}

export const SCALE: CommandFn = function* scale(ctx) {
  const list = yield* selectObjects(ctx)
  if (list.length === 0) return
  const b = yield { kind: 'point', message: 'Specify base point:' }
  if (b.kind !== 'point') return
  const base = b.p
  const a = yield {
    kind: 'number',
    message: 'Specify scale factor or [Reference] <1>:',
    base,
    default: 1,
    keywords: [kw('Reference')],
    preview: (p) => {
      const f = dist(base, p)
      return f > 0 ? { entities: moved(list, scaling(f, base)) } : {}
    },
  }
  let factor: number
  if (a.kind === 'keyword') {
    const ref = yield {
      kind: 'distance',
      message: 'Specify reference length <1>:',
      base,
      default: 1,
    }
    if (ref.kind !== 'number' || ref.value === 0) return
    const next = yield { kind: 'distance', message: 'Specify new length:', base }
    if (next.kind !== 'number') return
    factor = next.value / ref.value
  } else if (a.kind === 'number') factor = a.value
  else return
  if (!(factor > 0)) {
    ctx.message('The scale factor must be greater than zero.')
    return
  }
  applyTransform(ctx, list, scaling(factor, base), false)
}

export const MIRROR: CommandFn = function* mirror(ctx) {
  const list = yield* selectObjects(ctx)
  if (list.length === 0) return
  const a = yield { kind: 'point', message: 'Specify first point of mirror line:' }
  if (a.kind !== 'point') return
  const p1 = a.p
  const b = yield {
    kind: 'point',
    message: 'Specify second point of mirror line:',
    base: p1,
    preview: (p) => (dist(p, p1) > 0 ? { entities: moved(list, mirroring(p1, p)) } : {}),
  }
  if (b.kind !== 'point' || dist(b.p, p1) === 0) return
  const k = yield {
    kind: 'keyword',
    message: 'Erase source objects? [Yes/No] <No>:',
    keywords: [kw('Yes'), kw('No')],
    default: 'No',
  }
  if (k.kind !== 'keyword') return
  applyTransform(ctx, list, mirroring(p1, b.p), k.name !== 'Yes')
}

export const ERASE: CommandFn = function* erase(ctx) {
  const list = yield* selectObjects(ctx, false)
  if (list.length === 0) return
  ctx.doc.remove(...list.map((e) => e.handle))
  ctx.message(`Erased ${plural(list.length, 'object')}.`)
}

/** Replace an entity's geometry, keeping its handle, layer and look. */
function withShape(e: Entity, shape: CurveShape): Entity {
  return { ...e, ...shape } as Entity
}

export const OFFSET: CommandFn = function* offset(ctx) {
  const units = ctx.doc.units
  const d = yield {
    kind: 'distance',
    message: `Specify offset distance or [Through] <${formatDistance(ctx.settings.offsetDistance, units)}>:`,
    default: ctx.settings.offsetDistance,
    keywords: [kw('Through')],
  }
  const through = d.kind === 'keyword'
  if (d.kind === 'number') {
    if (!(d.value > 0)) {
      ctx.message('The offset distance must be greater than zero.')
      return
    }
    ctx.settings.offsetDistance = d.value
  } else if (!through) return
  const made: string[] = []
  for (;;) {
    const pick = yield {
      kind: 'entity',
      message: 'Select object to offset or [Exit/Undo] <Exit>:',
      keywords: [kw('Exit'), kw('Undo')],
      allowNone: true,
      filter: (e) => (isCurve(e) ? null : 'Cannot offset that object.'),
    }
    if (pick.kind === 'none' || (pick.kind === 'keyword' && pick.name === 'Exit')) return
    if (pick.kind === 'keyword') {
      const h = made.pop()
      if (h) ctx.doc.remove(h)
      continue
    }
    if (pick.kind !== 'entity') continue
    const e = ctx.doc.entities.get(pick.handle)
    if (!e || !isCurve(e)) continue
    const side = yield {
      kind: 'point',
      message: through ? 'Specify through point:' : 'Specify point on side to offset:',
      noRubber: true,
      preview: (p) => {
        const dist0 = through ? throughDistance(ctx, e, p) : ctx.settings.offsetDistance
        const r = dist0 > 0 ? offsetCurve(e, dist0, p) : 'none'
        return typeof r === 'string' ? {} : { entities: [withShape(e, r)] }
      },
    }
    if (side.kind !== 'point') return
    const distance = through ? throughDistance(ctx, e, side.p) : ctx.settings.offsetDistance
    const r = offsetCurve(e, distance, side.p)
    if (typeof r === 'string') {
      ctx.message(r)
      continue
    }
    const copy = { ...withShape(e, r), handle: ctx.doc.newHandle() } as Entity
    ctx.doc.add(copy)
    made.push(copy.handle)
  }
}

function throughDistance(ctx: CommandContext, e: Entity, p: Vec): number {
  let d = Infinity
  for (const s of ctx.segsOf(e)) {
    if (s.kind === 'line') {
      // Distance to the infinite line, as OFFSET Through measures it.
      const dx = s.b.x - s.a.x
      const dy = s.b.y - s.a.y
      const l = Math.hypot(dx, dy)
      if (l > 0) d = Math.min(d, Math.abs((p.x - s.a.x) * dy - (p.y - s.a.y) * dx) / l)
    } else d = Math.min(d, Math.abs(dist(p, s.c) - s.r))
  }
  return Number.isFinite(d) ? d : 0
}

/** Cutting or boundary edges: the chosen ones, or every visible object near the target. */
function edgesFor(
  ctx: CommandContext,
  target: Entity,
  chosen: string[] | null,
  box: Bounds
): Seg[] {
  const list = chosen
    ? chosen.map((h) => ctx.doc.entities.get(h)).filter((e): e is Entity => e !== undefined)
    : ctx.entitiesIn(box)
  return list.filter((e) => e.handle !== target.handle).flatMap((e) => ctx.segsOf(e))
}

function* trimOrExtend(ctx: CommandContext, mode: 'trim' | 'extend'): CommandGen {
  let chosen: string[] | null = null
  const steps: { before: Entity; after: Entity[] }[] = []
  const edgeWord = mode === 'trim' ? 'cuTting edges' : 'Boundary edges'
  for (;;) {
    const pick = yield {
      kind: 'entity',
      message: `Select object to ${mode} or [${edgeWord}/Undo]:`,
      keywords: [
        mode === 'trim' ? kw('cuTting edges', 'T') : kw('Boundary edges', 'B'),
        kw('Undo'),
      ],
      allowNone: true,
      filter: (e) => (isCurve(e) ? null : `Cannot ${mode} that object.`),
    }
    if (pick.kind === 'none') return
    if (pick.kind === 'keyword' && pick.name === 'Undo') {
      const last = steps.pop()
      if (!last) ctx.message('Nothing to undo.')
      else {
        ctx.doc.remove(...last.after.map((e) => e.handle))
        ctx.doc.add(last.before)
      }
      continue
    }
    if (pick.kind === 'keyword') {
      const sel = yield {
        kind: 'select',
        message: `Select ${mode === 'trim' ? 'cutting' : 'boundary'} edges (Enter for all objects):`,
      }
      chosen = sel.kind === 'selection' && sel.handles.length > 0 ? sel.handles : null
      continue
    }
    if (pick.kind !== 'entity') continue
    const e = ctx.doc.entities.get(pick.handle)
    if (!e || !isCurve(e)) continue
    const b = entityBounds(e, ctx.doc.getBlock)
    if (mode === 'trim') {
      const r = trimCurve(e, pick.at, edgesFor(ctx, e, chosen, b))
      if (typeof r === 'string') {
        ctx.message(r)
        continue
      }
      // The first piece keeps the handle; others are new objects.
      const [first, ...rest] = r.pieces
      const after: Entity[] = []
      if (!first) ctx.doc.remove(e.handle)
      else {
        const kept = withShape(e, first)
        ctx.doc.replace(kept)
        after.push(kept)
        for (const piece of rest) {
          const copy = { ...withShape(e, piece), handle: ctx.doc.newHandle() } as Entity
          ctx.doc.add(copy)
          after.push(copy)
        }
      }
      steps.push({ before: e, after })
    } else {
      // Boundaries can be far off: look along the whole drawing when none were chosen.
      const box = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity }
      const r = extendCurve(e, pick.at, edgesFor(ctx, e, chosen, box))
      if (typeof r === 'string') {
        ctx.message(r)
        continue
      }
      const grown = withShape(e, r)
      ctx.doc.replace(grown)
      steps.push({ before: e, after: [grown] })
    }
  }
}

export const TRIM: CommandFn = (ctx) => trimOrExtend(ctx, 'trim')
export const EXTEND: CommandFn = (ctx) => trimOrExtend(ctx, 'extend')

export const FILLET: CommandFn = function* filletCmd(ctx) {
  const units = ctx.doc.units
  ctx.message(`Current settings: Radius = ${formatDistance(ctx.settings.filletRadius, units)}`)
  let first: { handle: string; at: Vec } | null = null
  while (!first) {
    const a = yield {
      kind: 'entity',
      message: 'Select first object or [Radius]:',
      keywords: [kw('Radius')],
      filter: (e) =>
        e.kind === 'line' || e.kind === 'arc' ? null : 'FILLET works on lines and arcs.',
    }
    if (a.kind === 'keyword') {
      const r = yield {
        kind: 'distance',
        message: `Specify fillet radius <${formatDistance(ctx.settings.filletRadius, units)}>:`,
        default: ctx.settings.filletRadius,
      }
      if (r.kind === 'number' && r.value >= 0) ctx.settings.filletRadius = r.value
      continue
    }
    if (a.kind !== 'entity') return
    first = { handle: a.handle, at: a.at }
  }
  const b = yield {
    kind: 'entity',
    message: 'Select second object:',
    filter: (e) =>
      e.handle === first.handle
        ? 'Select a different object.'
        : e.kind === 'line' || e.kind === 'arc'
          ? null
          : 'FILLET works on lines and arcs.',
  }
  if (b.kind !== 'entity') return
  const e1 = ctx.doc.entities.get(first.handle)
  const e2 = ctx.doc.entities.get(b.handle)
  if (!e1 || !e2) return
  const r = fillet(e1, first.at, e2, b.at, ctx.settings.filletRadius)
  if (typeof r === 'string') {
    ctx.message(r)
    return
  }
  ctx.doc.replace(withShape(e1, r.first), withShape(e2, r.second))
  if (r.arc)
    ctx.doc.add(ctx.doc.create(r.arc, { layer: e1.layer, color: e1.color, linetype: e1.linetype }))
}
