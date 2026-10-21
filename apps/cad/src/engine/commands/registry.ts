/**
 * Every command, by name and AutoCAD alias, plus the view and utility
 * commands (UNDO, REDO, ZOOM, PAN, LAYER, -LAYER, UNITS, CHPROP).
 */
import { BYLAYER, type Layer, type UnitSystem } from '../model/types'
import { DEFAULT_LAYER } from '../model/document'
import { ARC, CIRCLE, LINE, PLINE, RECTANG, TEXT } from './draw'
import { COPY, ERASE, EXTEND, FILLET, MIRROR, MOVE, OFFSET, ROTATE, SCALE, TRIM } from './modify'
import { kw, type CommandDef, type CommandFn } from './types'

const UNDO: CommandFn = function* undo(ctx) {
  const a = yield {
    kind: 'number',
    message: 'Enter the number of operations to undo <1>:',
    default: 1,
  }
  if (a.kind !== 'number') return
  const n = Math.max(1, Math.floor(a.value))
  const done = ctx.undo(n)
  ctx.message(done === 0 ? 'Nothing to undo.' : `Undid ${done} operation${done === 1 ? '' : 's'}.`)
}

const U: CommandFn = function* u(ctx) {
  if (ctx.undo(1) === 0) ctx.message('Nothing to undo.')
  yield* []
}

const REDO: CommandFn = function* redo(ctx) {
  if (!ctx.redo()) ctx.message('Nothing to redo.')
  yield* []
}

const ZOOM: CommandFn = function* zoom(ctx) {
  const a = yield {
    kind: 'point',
    message:
      'Specify corner of window, enter a scale factor (nX), or [All/Extents/Previous/Window] <Extents>:',
    keywords: [kw('All'), kw('Extents'), kw('Previous'), kw('Window')],
    allowNone: true,
    acceptFactor: true,
  }
  if (a.kind === 'number') {
    if (a.value > 0) ctx.zoomBy(a.value)
    return
  }
  if (a.kind === 'none' || (a.kind === 'keyword' && (a.name === 'Extents' || a.name === 'All'))) {
    ctx.zoomExtents()
    return
  }
  if (a.kind === 'keyword' && a.name === 'Previous') {
    if (!ctx.zoomPrevious()) ctx.message('No previous view.')
    return
  }
  let first = a.kind === 'point' ? a.p : null
  if (a.kind === 'keyword' && a.name === 'Window') {
    const c = yield { kind: 'point', message: 'Specify first corner:' }
    if (c.kind !== 'point') return
    first = c.p
  }
  if (!first) return
  const corner = first
  const b = yield {
    kind: 'point',
    message: 'Specify opposite corner:',
    base: corner,
    noRubber: true,
    preview: (p) => ({
      segs: [
        { kind: 'line', a: corner, b: { x: p.x, y: corner.y } },
        { kind: 'line', a: { x: p.x, y: corner.y }, b: p },
        { kind: 'line', a: p, b: { x: corner.x, y: p.y } },
        { kind: 'line', a: { x: corner.x, y: p.y }, b: corner },
      ],
    }),
  }
  if (b.kind !== 'point') return
  ctx.zoomWindow(corner, b.p)
}

const PAN: CommandFn = function* pan() {
  yield { kind: 'pan', message: 'Drag to pan. Press Esc or Enter to exit.', allowNone: true }
}

const LAYER: CommandFn = function* layer(ctx) {
  ctx.openLayerDialog()
  yield* []
}

/** -LAYER: the command-line layer tool. */
const DASH_LAYER: CommandFn = function* dashLayer(ctx) {
  const doc = ctx.doc
  for (;;) {
    ctx.message(`Current layer: "${doc.currentLayer}"`)
    const a = yield {
      kind: 'keyword',
      message: 'Enter an option [Make/Set/New/ON/OFF/Color/Freeze/Thaw/LOck/Unlock]:',
      keywords: [
        kw('Make', 'M'),
        kw('Set', 'S'),
        kw('New', 'N'),
        kw('ON', 'ON'),
        kw('OFF', 'OFF'),
        kw('Color', 'C'),
        kw('Freeze', 'F'),
        kw('Thaw', 'T'),
        kw('LOck', 'LO'),
        kw('Unlock', 'U'),
      ],
      allowNone: true,
    }
    if (a.kind !== 'keyword') return
    const name = yield {
      kind: 'text',
      message: a.name === 'Color' ? 'Enter color number (1–255):' : 'Enter layer name:',
      allowNone: true,
    }
    if (name.kind !== 'text' || name.value.trim() === '') continue
    const value = name.value.trim()
    const existing = [...doc.layers.values()].find(
      (l) => l.name.toUpperCase() === value.toUpperCase()
    )
    const set = (l: Layer, patch: Partial<Layer>) => doc.setLayer({ ...l, ...patch })
    switch (a.name) {
      case 'Make':
      case 'New': {
        if (!isLayerName(value)) {
          ctx.message(`"${value}" is not a valid layer name.`)
          break
        }
        if (!existing) doc.setLayer({ ...DEFAULT_LAYER, name: value })
        if (a.name === 'Make') doc.setCurrentLayer(existing?.name ?? value)
        break
      }
      case 'Set':
        if (existing) doc.setCurrentLayer(existing.name)
        else ctx.message(`Cannot find layer "${value}".`)
        break
      case 'Color': {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 1 || n > 255) {
          ctx.message('A colour is a number from 1 to 255.')
          break
        }
        const which = yield {
          kind: 'text',
          message: `Enter name of layer for color ${n} <${doc.currentLayer}>:`,
          allowNone: true,
        }
        const target =
          which.kind === 'text' && which.value.trim() ? which.value.trim() : doc.currentLayer
        const l = [...doc.layers.values()].find(
          (x) => x.name.toUpperCase() === target.toUpperCase()
        )
        if (l) set(l, { color: n, rgb: undefined })
        else ctx.message(`Cannot find layer "${target}".`)
        break
      }
      default: {
        if (!existing) {
          ctx.message(`Cannot find layer "${value}".`)
          break
        }
        const patch: Partial<Layer> =
          a.name === 'ON'
            ? { on: true }
            : a.name === 'OFF'
              ? { on: false }
              : a.name === 'Freeze'
                ? { frozen: true }
                : a.name === 'Thaw'
                  ? { frozen: false }
                  : a.name === 'LOck'
                    ? { locked: true }
                    : { locked: false }
        if (a.name === 'Freeze' && existing.name === doc.currentLayer) {
          ctx.message('Cannot freeze the current layer.')
          break
        }
        set(existing, patch)
      }
    }
  }
}

export const isLayerName = (s: string): boolean =>
  s.length > 0 && s.length <= 255 && !/[<>/\\":;?*|=`,]/.test(s)

const UNITS: CommandFn = function* units(ctx) {
  const doc = ctx.doc
  const a = yield {
    kind: 'keyword',
    message: `Enter units [Decimal/Architectural/Metric] <${doc.units.system[0].toUpperCase()}${doc.units.system.slice(1)}>:`,
    keywords: [kw('Decimal'), kw('Architectural'), kw('Metric')],
    allowNone: true,
  }
  if (a.kind !== 'keyword') return
  const system = a.name.toLowerCase() as UnitSystem
  doc.setUnits({ ...doc.units, system })
}

/** CHPROP: change the layer or colour of the selected objects. */
const CHPROP: CommandFn = function* chprop(ctx) {
  let handles = ctx.takeSelection()
  if (!handles) {
    const s = yield { kind: 'select', message: 'Select objects:' }
    if (s.kind !== 'selection') return
    handles = s.handles
  }
  if (handles.length === 0) return
  for (;;) {
    const a = yield {
      kind: 'keyword',
      message: 'Enter property to change [Color/LAyer]:',
      keywords: [kw('Color'), kw('LAyer', 'LA')],
      allowNone: true,
    }
    if (a.kind !== 'keyword') return
    const list = handles.map((h) => ctx.doc.entities.get(h)).filter((e) => e !== undefined)
    if (a.name === 'LAyer') {
      const n = yield {
        kind: 'text',
        message: `Enter new layer name <${ctx.doc.currentLayer}>:`,
        allowNone: true,
      }
      const name = n.kind === 'text' && n.value.trim() ? n.value.trim() : ctx.doc.currentLayer
      const layer = [...ctx.doc.layers.values()].find(
        (l) => l.name.toUpperCase() === name.toUpperCase()
      )
      if (!layer) {
        ctx.message(`Cannot find layer "${name}".`)
        continue
      }
      ctx.doc.replace(...list.map((e) => ({ ...e, layer: layer.name })))
    } else {
      const n = yield {
        kind: 'text',
        message: 'Enter new color (1–255, ByLayer, ByBlock) <ByLayer>:',
        allowNone: true,
      }
      const v = n.kind === 'text' ? n.value.trim().toUpperCase() : 'BYLAYER'
      const color = v === '' || v === 'BYLAYER' ? BYLAYER : v === 'BYBLOCK' ? 0 : Number(v)
      if (!Number.isInteger(color) || color < 0 || color > 256) {
        ctx.message('A colour is a number from 1 to 255, ByLayer or ByBlock.')
        continue
      }
      ctx.doc.replace(...list.map((e) => ({ ...e, color, rgb: undefined })))
    }
  }
}

export const COMMANDS: CommandDef[] = [
  { name: 'LINE', aliases: ['L'], label: 'Line', run: LINE },
  { name: 'PLINE', aliases: ['PL'], label: 'Polyline', run: PLINE },
  { name: 'CIRCLE', aliases: ['C'], label: 'Circle', run: CIRCLE },
  { name: 'ARC', aliases: ['A'], label: 'Arc', run: ARC },
  { name: 'RECTANG', aliases: ['REC', 'RECTANGLE'], label: 'Rectangle', run: RECTANG },
  { name: 'TEXT', aliases: ['DT', 'DTEXT'], label: 'Text', run: TEXT },
  { name: 'MOVE', aliases: ['M'], label: 'Move', run: MOVE },
  { name: 'COPY', aliases: ['CO', 'CP'], label: 'Copy', run: COPY },
  { name: 'ROTATE', aliases: ['RO'], label: 'Rotate', run: ROTATE },
  { name: 'SCALE', aliases: ['SC'], label: 'Scale', run: SCALE },
  { name: 'MIRROR', aliases: ['MI'], label: 'Mirror', run: MIRROR },
  { name: 'OFFSET', aliases: ['O'], label: 'Offset', run: OFFSET },
  { name: 'TRIM', aliases: ['TR'], label: 'Trim', run: TRIM },
  { name: 'EXTEND', aliases: ['EX'], label: 'Extend', run: EXTEND },
  { name: 'FILLET', aliases: ['F'], label: 'Fillet', run: FILLET },
  { name: 'ERASE', aliases: ['E', 'DELETE'], label: 'Erase', run: ERASE },
  { name: 'UNDO', aliases: [], label: 'Undo', run: UNDO },
  { name: 'U', aliases: [], label: 'Undo', run: U },
  { name: 'REDO', aliases: [], label: 'Redo', run: REDO },
  { name: 'ZOOM', aliases: ['Z'], label: 'Zoom', run: ZOOM },
  { name: 'PAN', aliases: ['P'], label: 'Pan', run: PAN },
  { name: 'LAYER', aliases: ['LA'], label: 'Layers', run: LAYER },
  { name: '-LAYER', aliases: ['-LA'], label: 'Layer (command line)', run: DASH_LAYER },
  { name: 'UNITS', aliases: ['UN'], label: 'Units', run: UNITS },
  { name: 'CHPROP', aliases: ['CH'], label: 'Change properties', run: CHPROP },
]

const BY_NAME = new Map<string, CommandDef>()
for (const c of COMMANDS) {
  BY_NAME.set(c.name, c)
  for (const a of c.aliases) BY_NAME.set(a, c)
}

/** A command by name or alias (`L`, `line`, `_LINE`). */
export function findCommand(text: string): CommandDef | undefined {
  const t = text
    .trim()
    .toUpperCase()
    .replace(/^[_.']+/, '')
  return BY_NAME.get(t)
}
