/** LINE, PLINE, CIRCLE, ARC, RECTANG and TEXT. */
import { arcThrough, circumcenter, type Seg } from '../geom/seg'
import { angleFrom, cross, dist, dot, mid, normAngle, polar, sub, type Vec } from '../geom/vec'
import { dsegFromBulge, dTangent, polySegs } from '../geom/path'
import { formatDistance } from '../model/units'
import type { Entity, PolyVertex } from '../model/types'
import { kw, type CommandContext, type CommandFn, type CommandGen, type Prompt } from './types'

const lineSeg = (a: Vec, b: Vec): Seg => ({ kind: 'line', a, b })

export const LINE: CommandFn = function* line(ctx) {
  let a = yield { kind: 'point', message: 'Specify first point:' }
  if (a.kind !== 'point') return
  const first = a.p
  const pts: Vec[] = [first]
  const made: string[] = []
  for (;;) {
    const last = pts[pts.length - 1]
    const keywords = made.length >= 2 ? [kw('Close'), kw('Undo')] : [kw('Undo')]
    a = yield {
      kind: 'point',
      message: `Specify next point or [${keywords.map((k) => k.name).join('/')}]:`,
      base: last,
      keywords,
      allowNone: true,
    }
    if (a.kind === 'none') return
    if (a.kind === 'keyword' && a.name === 'Undo') {
      const h = made.pop()
      if (h) {
        ctx.doc.remove(h)
        pts.pop()
      } else ctx.message('All segments already undone.')
      continue
    }
    if (a.kind === 'keyword' && a.name === 'Close') {
      ctx.doc.add(ctx.doc.create({ kind: 'line', a: last, b: first }))
      return
    }
    if (a.kind !== 'point') continue
    if (dist(a.p, last) === 0) {
      ctx.message('That is the same point.')
      continue
    }
    const e = ctx.doc.create({ kind: 'line', a: last, b: a.p })
    ctx.doc.add(e)
    made.push(e.handle)
    pts.push(a.p)
  }
}

/** The bulge of a tangent arc leaving `from` along `tangent` and ending at `to`. */
export function tangentBulge(from: Vec, tangent: Vec, to: Vec): number {
  const c = sub(to, from)
  return Math.tan(Math.atan2(cross(tangent, c), dot(tangent, c)) / 2)
}

export const PLINE: CommandFn = function* pline(ctx) {
  let a = yield { kind: 'point', message: 'Specify start point:' }
  if (a.kind !== 'point') return
  const vertices: PolyVertex[] = [{ ...a.p, bulge: 0 }]
  let arcMode = false
  let handle: string | null = null
  const commit = (closed: boolean) => {
    const shape = {
      kind: 'polyline' as const,
      vertices: vertices.map((v) => ({ ...v })),
      closed,
      width: 0,
    }
    if (handle) {
      const prev = ctx.doc.entities.get(handle)
      if (prev) ctx.doc.replace({ ...prev, ...shape } as Entity)
    } else if (vertices.length > 1) {
      const e = ctx.doc.create(shape)
      handle = e.handle
      ctx.doc.add(e)
    }
  }
  // Direction of travel at the last vertex (for tangent arcs).
  const tangentAtEnd = (): Vec => {
    if (vertices.length < 2) return { x: 1, y: 0 }
    const segs = polySegs(vertices, false)
    return segs.length ? dTangent(segs[segs.length - 1], 1) : { x: 1, y: 0 }
  }
  for (;;) {
    const last = vertices[vertices.length - 1]
    const closeable = vertices.length >= 3
    const keywords = arcMode
      ? [kw('Line', 'L'), ...(closeable ? [kw('Close', 'CL')] : []), kw('Undo')]
      : [kw('Arc'), ...(closeable ? [kw('Close')] : []), kw('Undo')]
    const tangent = tangentAtEnd()
    a = yield {
      kind: 'point',
      message: arcMode
        ? `Specify endpoint of arc or [${keywords.map((k) => k.name).join('/')}]:`
        : `Specify next point or [${keywords.map((k) => k.name).join('/')}]:`,
      base: last,
      keywords,
      allowNone: true,
      noRubber: arcMode,
      preview: arcMode
        ? (p) => ({ segs: [toSeg(dsegFromBulge(last, p, tangentBulge(last, tangent, p)))] })
        : undefined,
    }
    if (a.kind === 'none') return
    if (a.kind === 'keyword') {
      if (a.name === 'Arc') arcMode = true
      else if (a.name === 'Line') arcMode = false
      else if (a.name === 'Undo') {
        if (vertices.length > 1) {
          vertices.pop()
          vertices[vertices.length - 1] = { ...vertices[vertices.length - 1], bulge: 0 }
          if (vertices.length === 1 && handle) {
            ctx.doc.remove(handle)
            handle = null
          } else commit(false)
        } else ctx.message('Nothing to undo.')
      } else if (a.name === 'Close') {
        if (arcMode)
          vertices[vertices.length - 1] = {
            ...last,
            bulge: tangentBulge(last, tangent, vertices[0]),
          }
        commit(true)
        return
      }
      continue
    }
    if (a.kind !== 'point' || dist(a.p, last) === 0) continue
    vertices[vertices.length - 1] = {
      ...last,
      bulge: arcMode ? tangentBulge(last, tangent, a.p) : 0,
    }
    vertices.push({ ...a.p, bulge: 0 })
    commit(false)
  }
}

function toSeg(s: ReturnType<typeof dsegFromBulge>): Seg {
  if (s.kind === 'line') return lineSeg(s.a, s.b)
  return s.sweep >= 0
    ? { kind: 'arc', c: s.c, r: s.r, start: normAngle(s.a0), end: normAngle(s.a0 + s.sweep) }
    : { kind: 'arc', c: s.c, r: s.r, start: normAngle(s.a0 + s.sweep), end: normAngle(s.a0) }
}

export const CIRCLE: CommandFn = function* circle(ctx) {
  let a = yield {
    kind: 'point',
    message: 'Specify center point for circle or [3P/2P]:',
    keywords: [kw('3P', '3P'), kw('2P', '2P')],
  }
  if (a.kind === 'keyword' && a.name === '2P') {
    const p1 = yield { kind: 'point', message: 'Specify first end point of circle’s diameter:' }
    if (p1.kind !== 'point') return
    const p2 = yield {
      kind: 'point',
      message: 'Specify second end point of circle’s diameter:',
      base: p1.p,
      preview: (p) => ({ segs: [{ kind: 'circle', c: mid(p1.p, p), r: dist(p1.p, p) / 2 }] }),
    }
    if (p2.kind !== 'point' || dist(p1.p, p2.p) === 0) return
    ctx.settings.circleRadius = dist(p1.p, p2.p) / 2
    ctx.doc.add(ctx.doc.create({ kind: 'circle', c: mid(p1.p, p2.p), r: dist(p1.p, p2.p) / 2 }))
    return
  }
  if (a.kind === 'keyword' && a.name === '3P') {
    const pts: Vec[] = []
    for (const label of ['first', 'second', 'third']) {
      const prev = pts.length === 2 ? pts : null
      const r = yield {
        kind: 'point',
        message: `Specify ${label} point on circle:`,
        base: pts[pts.length - 1],
        preview: prev
          ? (p) => {
              const c = circumcenter(prev[0], prev[1], p)
              return c ? { segs: [{ kind: 'circle', c, r: dist(c, p) }] } : {}
            }
          : undefined,
      }
      if (r.kind !== 'point') return
      pts.push(r.p)
    }
    const c = circumcenter(pts[0], pts[1], pts[2])
    if (!c) {
      ctx.message('The three points are on one line.')
      return
    }
    ctx.settings.circleRadius = dist(c, pts[0])
    ctx.doc.add(ctx.doc.create({ kind: 'circle', c, r: dist(c, pts[0]) }))
    return
  }
  if (a.kind !== 'point') return
  const c = a.p
  const units = ctx.doc.units
  a = yield {
    kind: 'distance',
    message: `Specify radius of circle or [Diameter] <${formatDistance(ctx.settings.circleRadius, units)}>:`,
    base: c,
    default: ctx.settings.circleRadius,
    keywords: [kw('Diameter')],
    preview: (p) => ({ segs: [{ kind: 'circle', c, r: dist(c, p) }] }),
  }
  let r: number
  if (a.kind === 'keyword') {
    const d = yield {
      kind: 'distance',
      message: `Specify diameter of circle <${formatDistance(ctx.settings.circleRadius * 2, units)}>:`,
      base: c,
      default: ctx.settings.circleRadius * 2,
      preview: (p) => ({ segs: [{ kind: 'circle', c, r: dist(c, p) / 2 }] }),
    }
    if (d.kind !== 'number') return
    r = d.value / 2
  } else if (a.kind === 'number') r = a.value
  else return
  if (!(r > 0)) {
    ctx.message('The radius must be greater than zero.')
    return
  }
  ctx.settings.circleRadius = r
  ctx.doc.add(ctx.doc.create({ kind: 'circle', c, r }))
}

export const ARC: CommandFn = function* arc(ctx) {
  let a = yield {
    kind: 'point',
    message: 'Specify start point of arc or [Center]:',
    keywords: [kw('Center')],
  }
  if (a.kind === 'keyword') return yield* arcFromCenter(ctx)
  if (a.kind !== 'point') return
  const p1 = a.p
  a = yield {
    kind: 'point',
    message: 'Specify second point of arc or [Center/End]:',
    base: p1,
    keywords: [kw('Center'), kw('End')],
  }
  if (a.kind === 'keyword' && a.name === 'Center') {
    const c = yield { kind: 'point', message: 'Specify center point of arc:', base: p1 }
    if (c.kind !== 'point') return
    return yield* arcCenterStart(ctx, c.p, p1)
  }
  if (a.kind === 'keyword' && a.name === 'End') {
    const e = yield { kind: 'point', message: 'Specify end point of arc:', base: p1 }
    if (e.kind !== 'point') return
    const c = yield {
      kind: 'point',
      message: 'Specify center point of arc:',
      base: e.p,
      preview: (p) => ({
        segs: [
          { kind: 'arc', c: p, r: dist(p, p1), start: angleFrom(p, p1), end: angleFrom(p, e.p) },
        ],
      }),
    }
    if (c.kind !== 'point') return
    addArc(ctx, c.p, dist(c.p, p1), angleFrom(c.p, p1), angleFrom(c.p, e.p))
    return
  }
  if (a.kind !== 'point') return
  const p2 = a.p
  const p3 = yield {
    kind: 'point',
    message: 'Specify end point of arc:',
    base: p2,
    noRubber: true,
    preview: (p) => {
      const s = arcThrough(p1, p2, p)
      return s ? { segs: [s] } : { segs: [lineSeg(p1, p)] }
    },
  }
  if (p3.kind !== 'point') return
  const s = arcThrough(p1, p2, p3.p)
  if (!s) {
    ctx.message('The three points are on one line.')
    return
  }
  addArc(ctx, s.c, s.r, s.start, s.end)
}

function* arcFromCenter(ctx: CommandContext): CommandGen {
  const c = yield { kind: 'point', message: 'Specify center point of arc:' }
  if (c.kind !== 'point') return
  const s = yield { kind: 'point', message: 'Specify start point of arc:', base: c.p }
  if (s.kind !== 'point') return
  yield* arcCenterStart(ctx, c.p, s.p)
}

function* arcCenterStart(ctx: CommandContext, c: Vec, s: Vec): CommandGen {
  const r = dist(c, s)
  if (r === 0) return
  const start = angleFrom(c, s)
  const e = yield {
    kind: 'point',
    message: 'Specify end point of arc or [Angle]:',
    base: c,
    keywords: [kw('Angle')],
    preview: (p) => ({ segs: [{ kind: 'arc', c, r, start, end: angleFrom(c, p) }] }),
  }
  if (e.kind === 'keyword') {
    const ang = yield { kind: 'angle', message: 'Specify included angle:', base: c }
    if (ang.kind !== 'number' || ang.value === 0) return
    if (ang.value > 0) addArc(ctx, c, r, start, start + ang.value)
    else addArc(ctx, c, r, start + ang.value, start)
    return
  }
  if (e.kind !== 'point') return
  addArc(ctx, c, r, start, angleFrom(c, e.p))
}

function addArc(ctx: CommandContext, c: Vec, r: number, start: number, end: number) {
  ctx.doc.add(ctx.doc.create({ kind: 'arc', c, r, start: normAngle(start), end: normAngle(end) }))
}

export const RECTANG: CommandFn = function* rectang(ctx) {
  const a = yield { kind: 'point', message: 'Specify first corner point:' }
  if (a.kind !== 'point') return
  const p1 = a.p
  const rect = (q: Vec): PolyVertex[] =>
    [p1, { x: q.x, y: p1.y }, q, { x: p1.x, y: q.y }].map((p) => ({ x: p.x, y: p.y, bulge: 0 }))
  let b = yield {
    kind: 'point',
    message: 'Specify other corner point or [Dimensions]:',
    base: p1,
    noRubber: true,
    keywords: [kw('Dimensions')],
    preview: (q) => ({ segs: rectSegs(rect(q)) }),
  }
  if (b.kind === 'keyword') {
    const units = ctx.doc.units
    const l = yield { kind: 'distance', message: 'Specify length for rectangles:', base: p1 }
    if (l.kind !== 'number') return
    const w = yield { kind: 'distance', message: 'Specify width for rectangles:', base: p1 }
    if (w.kind !== 'number') return
    ctx.message(`Rectangle ${formatDistance(l.value, units)} × ${formatDistance(w.value, units)}.`)
    const side = yield {
      kind: 'point',
      message: 'Specify other corner point (the side to draw on):',
      base: p1,
      noRubber: true,
      preview: (q) => ({ segs: rectSegs(rect(dimCorner(p1, q, l.value, w.value))) }),
    }
    if (side.kind !== 'point') return
    b = { kind: 'point', p: dimCorner(p1, side.p, l.value, w.value) }
  }
  if (b.kind !== 'point') return
  if (b.p.x === p1.x || b.p.y === p1.y) {
    ctx.message('A rectangle needs width and height.')
    return
  }
  ctx.doc.add(ctx.doc.create({ kind: 'polyline', vertices: rect(b.p), closed: true, width: 0 }))
}

function dimCorner(p1: Vec, toward: Vec, l: number, w: number): Vec {
  return { x: p1.x + (toward.x >= p1.x ? l : -l), y: p1.y + (toward.y >= p1.y ? w : -w) }
}

function rectSegs(v: PolyVertex[]): Seg[] {
  return v.map((p, i) => lineSeg(p, v[(i + 1) % v.length]))
}

export const TEXT: CommandFn = function* text(ctx) {
  const units = ctx.doc.units
  let a = yield {
    kind: 'point',
    message: 'Specify start point of text or [Justify]:',
    keywords: [kw('Justify')],
  }
  let halign = 0
  const valign = 0
  if (a.kind === 'keyword') {
    const j = yield {
      kind: 'keyword',
      message: 'Enter an option [Left/Center/Right/Middle] <Left>:',
      keywords: [kw('Left'), kw('Center'), kw('Right'), kw('Middle')],
      default: 'Left',
    }
    if (j.kind !== 'keyword') return
    halign = { Left: 0, Center: 1, Right: 2, Middle: 4 }[j.name] ?? 0
    a = yield {
      kind: 'point',
      message:
        halign === 0
          ? 'Specify start point of text:'
          : `Specify ${j.name.toLowerCase()} point of text:`,
    }
  }
  if (a.kind !== 'point') return
  let at = a.p
  const h = yield {
    kind: 'distance',
    message: `Specify height <${formatDistance(ctx.settings.textHeight, units)}>:`,
    base: at,
    default: ctx.settings.textHeight,
  }
  if (h.kind !== 'number' || !(h.value > 0)) return
  ctx.settings.textHeight = h.value
  const rot = yield {
    kind: 'angle',
    message: 'Specify rotation angle of text <0>:',
    base: at,
    default: 0,
  }
  if (rot.kind !== 'number') return
  const rotation = normAngle(rot.value)
  // One TEXT per line; each next line sits below the last, as DTEXT places them.
  for (;;) {
    const t = yield { kind: 'text', message: 'Enter text:', allowNone: true } as Prompt
    if (t.kind !== 'text' || t.value === '') return
    ctx.doc.add(
      ctx.doc.create({
        kind: 'text',
        position: at,
        height: h.value,
        rotation,
        value: t.value,
        style:
          ctx.doc.textStyles.find((s) => /^standard$/i.test(s)) ??
          ctx.doc.textStyles[0] ??
          'Standard',
        halign,
        valign,
        alignPoint: halign !== 0 || valign !== 0 ? at : undefined,
        widthFactor: 1,
      })
    )
    at = polar(at, h.value * (5 / 3), rotation - Math.PI / 2)
  }
}
