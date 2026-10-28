import { describe, expect, it } from 'vitest'
import { readDxf } from './dxf/read'
import { writeDxfBytes } from './dxf/write'
import { Editor } from './editor'
import type { Vec } from './geom/vec'
import type { Entity, LineEntity } from './model/types'

const P = (x: number, y: number) => ({ x, y })

/** An editor with a 1000×800 view showing x 0..20 (50 px per unit). */
function editor(): Editor {
  const ed = new Editor()
  ed.resize(1000, 800)
  ed.view.cx = 10
  ed.view.cy = 8
  ed.view.scale = 50
  ed.setToggles({ polar: false })
  return ed
}

function type(ed: Editor, ...lines: string[]) {
  for (const l of lines) ed.submit(l)
}

function click(ed: Editor, p: Vec, shift = false) {
  const s = ed.view.toScreen(p)
  ed.pointerMove(s)
  ed.pointerDown(s, 0, { shift })
  ed.pointerUp(s, 0)
}

const lines = (ed: Editor) => ed.doc.all().filter((e): e is LineEntity => e.kind === 'line')

function expectLine(l: LineEntity | undefined, ax: number, ay: number, bx: number, by: number) {
  expect(l).toBeDefined()
  expect(l!.a.x).toBeCloseTo(ax, 9)
  expect(l!.a.y).toBeCloseTo(ay, 9)
  expect(l!.b.x).toBeCloseTo(bx, 9)
  expect(l!.b.y).toBeCloseTo(by, 9)
}

/** The 10×8 room of the acceptance walk: four walls drawn with typed coordinates. */
function drawRoom(ed: Editor) {
  type(ed, 'L', '0,0', '@10,0', '@0,8', '@-10,0', 'C')
}

describe('typed coordinates and snaps (the spike)', () => {
  it('draws 0,0 → @4,0 → @3<90 and snaps a new line to the end', () => {
    const ed = editor()
    type(ed, 'LINE', '0,0', '@4,0', '@3<90', '')
    const [a, b] = lines(ed)
    expectLine(a, 0, 0, 4, 0)
    expectLine(b, 4, 0, 4, 3)
    // A second line from (8,8), ending on a click 0.1 unit off the corner: it lands on (4,3).
    type(ed, 'L', '8,8')
    click(ed, P(4.08, 3.06))
    ed.submit('')
    expectLine(lines(ed)[2], 8, 8, 4, 3)
    expect(ed.isIdle).toBe(true)
  })

  it('snaps to a midpoint and to an intersection', () => {
    const ed = editor()
    type(ed, 'L', '0,0', '10,0', '', 'L', '5,-3', '5,3', '')
    ed.setToggles({ snapModes: ['midpoint'] })
    type(ed, 'L')
    click(ed, P(2.6, 0.05))
    click(ed, P(5.1, 0.08))
    ed.submit('')
    // Both clicks: the first near (2.5,0) has no midpoint nearby, so it is the raw point.
    const l = lines(ed)[2]
    expect(l.b.x).toBeCloseTo(5, 9)
    expect(l.b.y).toBeCloseTo(0, 9)
    ed.setToggles({ snapModes: ['intersection'] })
    type(ed, 'L', '9,9')
    click(ed, P(5.05, -0.05))
    ed.submit('')
    expectLine(lines(ed)[3], 9, 9, 5, 0)
  })

  it('ortho squares a click and direct distance entry runs along the cursor', () => {
    const ed = editor()
    ed.setToggles({ ortho: true, osnap: false })
    type(ed, 'L', '1,1')
    click(ed, P(6, 2))
    ed.pointerMove(ed.view.toScreen(P(6, 9)))
    ed.submit('3')
    ed.submit('')
    const [a, b] = lines(ed)
    expectLine(a, 1, 1, 6, 1)
    expectLine(b, 6, 1, 6, 4)
  })

  it('polar tracking holds the cursor on 45° rays', () => {
    const ed = editor()
    ed.setToggles({ polar: true, osnap: false })
    type(ed, 'L', '0,0')
    click(ed, P(5, 5.05))
    ed.submit('')
    const l = lines(ed)[0]
    expect(l.b.x).toBeCloseTo(l.b.y, 9)
  })
})

describe('commands', () => {
  it('UNDO takes back a whole LINE command, REDO puts it back', () => {
    const ed = editor()
    drawRoom(ed)
    expect(lines(ed)).toHaveLength(4)
    ed.undo()
    expect(lines(ed)).toHaveLength(0)
    ed.redo()
    expect(lines(ed)).toHaveLength(4)
    type(ed, 'U')
    expect(lines(ed)).toHaveLength(0)
  })

  it('LINE Undo removes the last segment only', () => {
    const ed = editor()
    type(ed, 'L', '0,0', '@1,0', '@0,1', 'U', '@2,2', '')
    expect(lines(ed)).toHaveLength(2)
    expectLine(lines(ed)[1], 1, 0, 3, 2)
  })

  it('offsets the room walls 0.2 inward and trims the corners clean', () => {
    const ed = editor()
    ed.view.scale = 200
    ed.view.cx = 5
    ed.view.cy = 4
    drawRoom(ed)
    const walls = lines(ed)
    type(ed, 'O', '0.2')
    const pickAt: Vec[] = [P(5, 0), P(10, 4), P(5, 8), P(0, 4)]
    for (const p of pickAt) {
      click(ed, p)
      click(ed, P(5, 4))
    }
    ed.submit('')
    const inner = lines(ed).filter((l) => !walls.some((w) => w.handle === l.handle))
    expect(inner).toHaveLength(4)
    expectLine(inner[0], 0, 0.2, 10, 0.2)
    expectLine(inner[1], 9.8, 0, 9.8, 8)
    // TRIM the eight 0.2 overhangs where the inner walls cross.
    type(ed, 'TR')
    for (const p of [
      P(0.1, 0.2),
      P(9.9, 0.2),
      P(9.8, 0.1),
      P(9.8, 7.9),
      P(9.9, 7.8),
      P(0.1, 7.8),
      P(0.2, 7.9),
      P(0.2, 0.1),
    ])
      click(ed, p)
    ed.submit('')
    const trimmed = ed.doc
      .all()
      .filter((e) => inner.some((i) => i.handle === e.handle)) as LineEntity[]
    expectLine(trimmed[0], 0.2, 0.2, 9.8, 0.2)
    expectLine(trimmed[1], 9.8, 0.2, 9.8, 7.8)
    expectLine(trimmed[2], 9.8, 7.8, 0.2, 7.8)
    expectLine(trimmed[3], 0.2, 7.8, 0.2, 0.2)
    // One undo step per command: TRIM goes back as a whole.
    ed.undo()
    expectLine(ed.doc.entities.get(inner[0].handle) as LineEntity, 0, 0.2, 10, 0.2)
  })

  it('FILLET radius 0 closes a corner left open', () => {
    const ed = editor()
    ed.view.scale = 100
    type(ed, 'L', '1,0', '10,0', '', 'L', '0,1', '0,8', '')
    type(ed, 'F')
    click(ed, P(5, 0))
    click(ed, P(0, 5))
    const [a, b] = lines(ed)
    expectLine(a, 10, 0, 0, 0)
    expectLine(b, 0, 8, 0, 0)
  })

  it('FILLET with a radius adds the tangent arc', () => {
    const ed = editor()
    type(ed, 'L', '0,0', '10,0', '', 'L', '0,0', '0,10', '', 'F', 'R', '2')
    click(ed, P(5, 0))
    click(ed, P(0, 5))
    const arc = ed.doc.all().find((e) => e.kind === 'arc')
    expect(arc?.kind === 'arc' && arc.r).toBeCloseTo(2, 12)
  })

  it('EXTEND runs a line to a boundary', () => {
    const ed = editor()
    type(ed, 'L', '0,0', '5,0', '', 'L', '8,-2', '8,2', '', 'EX')
    click(ed, P(4.5, 0))
    ed.submit('')
    expectLine(lines(ed)[0], 0, 0, 8, 0)
  })

  it('MOVE, COPY, ROTATE, SCALE and MIRROR with typed points', () => {
    const ed = editor()
    type(ed, 'L', '0,0', '2,0', '')
    const h = lines(ed)[0].handle
    ed.selectAll()
    type(ed, 'M', '0,0', '@1,1')
    expectLine(ed.doc.entities.get(h) as LineEntity, 1, 1, 3, 1)
    ed.selectAll()
    type(ed, 'RO', '1,1', '90')
    expectLine(ed.doc.entities.get(h) as LineEntity, 1, 1, 1, 3)
    ed.selectAll()
    type(ed, 'SC', '1,1', '2')
    expectLine(ed.doc.entities.get(h) as LineEntity, 1, 1, 1, 5)
    ed.selectAll()
    type(ed, 'MI', '0,0', '0,10', 'N')
    expect(lines(ed)).toHaveLength(2)
    expectLine(lines(ed)[1], -1, 1, -1, 5)
    ed.selectAll()
    type(ed, 'CO', '0,0', '@10,0', '@20,0', '')
    expect(lines(ed)).toHaveLength(6)
  })

  it('draws circles, arcs, rectangles, polylines and text', () => {
    const ed = editor()
    type(
      ed,
      'C',
      '0,0',
      '2',
      'C',
      '2P',
      '0,0',
      '4,0',
      'A',
      '1,0',
      '0,1',
      '-1,0',
      'REC',
      '0,0',
      '@10,8'
    )
    type(
      ed,
      'PL',
      '0,0',
      '5,0',
      'A',
      '5,5',
      'L',
      '0,5',
      '',
      'DT',
      '1,1',
      '0.5',
      '0',
      'Kitchen',
      'Bath',
      ''
    )
    const kinds = ed.doc.all().map((e) => e.kind)
    expect(kinds).toEqual(['circle', 'circle', 'arc', 'polyline', 'polyline', 'text', 'text'])
    const all = ed.doc.all()
    expect(all[1].kind === 'circle' && all[1].c).toEqual(P(2, 0))
    const arc = all[2]
    expect(arc.kind === 'arc' && arc.r).toBeCloseTo(1, 12)
    const rect = all[3]
    expect(rect.kind === 'polyline' && rect.closed).toBe(true)
    const pl = all[4]
    expect(
      pl.kind === 'polyline' && pl.vertices.map((v) => [v.x, v.y, Math.round(v.bulge * 1e9) / 1e9])
    ).toEqual([
      [0, 0, 0],
      [5, 0, 1],
      [5, 5, 0],
      [0, 5, 0],
    ])
    expect(all[5].kind === 'text' && all[5].value).toBe('Kitchen')
    expect(all[6].kind === 'text' && all[6].position.y).toBeLessThan(1)
  })

  it('puts walls on a new WALLS layer through -LAYER and the layer dropdown', () => {
    const ed = editor()
    drawRoom(ed)
    type(ed, '-LAYER', 'M', 'WALLS', '')
    expect(ed.doc.currentLayer).toBe('WALLS')
    expect(lines(ed).every((l) => l.layer === '0')).toBe(true)
    // A window round the whole room (left to right) selects the four walls.
    const a = ed.view.toScreen(P(-1, -1))
    const b = ed.view.toScreen(P(11, 9))
    ed.pointerMove(a)
    ed.pointerDown(a, 0)
    ed.pointerMove(b, 1)
    ed.pointerUp(b, 0)
    expect(ed.selection.size).toBe(4)
    ed.chooseLayer('WALLS')
    expect(lines(ed).every((l) => l.layer === 'WALLS')).toBe(true)
    ed.undo()
    expect(lines(ed).every((l) => l.layer === '0')).toBe(true)
  })

  it('window takes what is inside, crossing also what it touches', () => {
    const ed = editor()
    type(ed, 'L', '1,1', '3,1', '', 'L', '2,0', '2,10', '')
    const box = (from: Vec, to: Vec) => {
      ed.cancel()
      ed.cancel()
      click(ed, from)
      click(ed, to)
      return ed.selection.size
    }
    expect(box(P(0, 0), P(4, 2))).toBe(1)
    expect(box(P(4, 2), P(0, 0))).toBe(2)
  })

  it('a grip stretches the end of a selected line', () => {
    const ed = editor()
    type(ed, 'L', '0,0', '4,0', '')
    const h = lines(ed)[0].handle
    click(ed, P(2, 0))
    expect(ed.selection.has(h)).toBe(true)
    ed.setToggles({ osnap: false })
    click(ed, P(4, 0))
    expect(ed.state.commandName).toBe('GRIP')
    type(ed, '6,3')
    expectLine(ed.doc.entities.get(h) as LineEntity, 0, 0, 6, 3)
    // The midpoint grip moves the whole line.
    click(ed, P(3, 1.5))
    expect(ed.state.commandName).toBe('GRIP')
    type(ed, '@1,0')
    expectLine(ed.doc.entities.get(h) as LineEntity, 1, 0, 7, 3)
  })

  it('ZOOM Extents fits the drawing and ZOOM Window fits a box', () => {
    const ed = editor()
    type(ed, 'L', '100,100', '200,150', '', 'Z', 'E')
    const s = ed.view.toScreen(P(150, 125))
    expect(s.x).toBeCloseTo(500, 6)
    expect(s.y).toBeCloseTo(400, 6)
    type(ed, 'Z', '0,0', '10,10')
    expect(ed.view.scale).toBeCloseTo(80, 6)
    type(ed, 'Z', 'P')
    expect(ed.view.toScreen(P(150, 125)).x).toBeCloseTo(500, 6)
  })

  it('erases with ERASE and with the Delete key', () => {
    const ed = editor()
    drawRoom(ed)
    ed.selectAll()
    ed.eraseSelection()
    expect(ed.doc.entities.size).toBe(0)
    ed.undo()
    expect(ed.doc.entities.size).toBe(4)
    type(ed, 'E', 'ALL', '')
    expect(ed.doc.entities.size).toBe(0)
  })

  it('switches units and reads feet and inches', () => {
    const ed = editor()
    type(ed, 'UNITS', 'A', 'L', `0,0`, `@10'<0`, '')
    expectLine(lines(ed)[0], 0, 0, 120, 0)
  })

  it('names unknown commands and keeps going', () => {
    const ed = editor()
    type(ed, 'FOO')
    expect(ed.state.history.at(-1)).toMatch(/Unknown command "FOO"/)
    expect(ed.isIdle).toBe(true)
  })

  it('the 10×8 room survives a save and a reopen', () => {
    const ed = editor()
    ed.view.scale = 200
    ed.view.cx = 5
    ed.view.cy = 4
    drawRoom(ed)
    type(ed, 'O', '0.2')
    for (const p of [P(5, 0), P(10, 4), P(5, 8), P(0, 4)]) {
      click(ed, p)
      click(ed, P(5, 4))
    }
    ed.submit('')
    type(ed, 'TR')
    for (const p of [
      P(0.1, 0.2),
      P(9.9, 0.2),
      P(9.8, 0.1),
      P(9.8, 7.9),
      P(9.9, 7.8),
      P(0.1, 7.8),
      P(0.2, 7.9),
      P(0.2, 0.1),
    ])
      click(ed, p)
    ed.submit('')
    type(ed, '-LAYER', 'M', 'WALLS', '')
    ed.selectAll()
    ed.chooseLayer('WALLS')
    const back = readDxf(writeDxfBytes(ed.doc).bytes).doc
    const strip = (e: Entity) => ({ ...e, handle: '' })
    expect(back.all().map(strip)).toEqual(ed.doc.all().map(strip))
    expect(back.layers.get('WALLS')).toBeDefined()
    expect(back.currentLayer).toBe('WALLS')
  })
})

describe('TRIM and EXTEND pick the short stub at a corner (brief 11)', () => {
  /** The 10×8 room and its walls offset 0.2 inward, at the given scale (px per unit). */
  function offsetRoom(scale: number) {
    const ed = editor()
    ed.view.scale = 200
    ed.view.cx = 5
    ed.view.cy = 4
    drawRoom(ed)
    const walls = lines(ed)
    type(ed, 'O', '0.2')
    for (const p of [P(5, 0), P(10, 4), P(5, 8), P(0, 4)]) {
      click(ed, p)
      click(ed, P(5, 4))
    }
    ed.submit('')
    const inner = lines(ed).filter((l) => !walls.some((w) => w.handle === l.handle))
    ed.view.scale = scale
    return { ed, walls, inner }
  }

  /**
   * A pick 2 px into the stub from where it meets the wall and 3 px beside it,
   * on the room's side: the wall is nearer than the stub.
   */
  function nearCorner(ed: Editor, [wallEnd, into, inward]: Stub): Vec {
    const px = 1 / ed.view.scale
    return P(
      wallEnd.x + (into.x * 2 + inward.x * 3) * px,
      wallEnd.y + (into.y * 2 + inward.y * 3) * px
    )
  }

  /** Where a 0.2 overhang meets the wall, the way along it, and the room's side of it. */
  type Stub = [Vec, Vec, Vec]
  const STUBS: Stub[] = [
    [P(0, 0.2), P(1, 0), P(0, 1)],
    [P(10, 0.2), P(-1, 0), P(0, 1)],
    [P(9.8, 0), P(0, 1), P(-1, 0)],
    [P(9.8, 8), P(0, -1), P(-1, 0)],
    [P(10, 7.8), P(-1, 0), P(0, -1)],
    [P(0, 7.8), P(1, 0), P(0, -1)],
    [P(0.2, 8), P(0, -1), P(1, 0)],
    [P(0.2, 0), P(0, 1), P(1, 0)],
  ]

  // The walk's stubs were 6–13 px long: 30 to 65 px per unit.
  it.each([30, 50, 65])(
    'trims each of the eight stubs from a pick 2 px from its corner, the wall 2 px away (%i px/unit)',
    (scale) => {
      const { ed, walls, inner } = offsetRoom(scale)
      type(ed, 'TR')
      for (const stub of STUBS) {
        const [wallEnd] = stub
        click(ed, nearCorner(ed, stub))
        // The walls are untouched: the stub went, not the wall beside it.
        for (const w of walls)
          expect(ed.doc.entities.get(w.handle), `${wallEnd.x},${wallEnd.y}`).toBe(w)
        expect(lines(ed)).toHaveLength(8)
      }
      ed.submit('')
      const trimmed = inner.map((l) => ed.doc.entities.get(l.handle) as LineEntity)
      expectLine(trimmed[0], 0.2, 0.2, 9.8, 0.2)
      expectLine(trimmed[1], 9.8, 0.2, 9.8, 7.8)
      expectLine(trimmed[2], 9.8, 7.8, 0.2, 7.8)
      expectLine(trimmed[3], 0.2, 7.8, 0.2, 0.2)
    }
  )

  it('trims the wall from a pick in its middle, the parallel inner wall inside the pick box', () => {
    // At 20 px per unit the inner wall is 4 px off: both are candidates.
    const { ed, walls, inner } = offsetRoom(20)
    type(ed, 'TR')
    click(ed, P(5, 0.08))
    ed.submit('')
    expect(ed.doc.entities.get(walls[0].handle)).not.toBe(walls[0])
    for (const l of inner) expect(ed.doc.entities.get(l.handle)).toBe(l)
  })

  it('takes the curve beside a non-curve, not "Cannot trim that object."', () => {
    const ed = editor()
    type(ed, 'L', '0,0', '10,0', '', 'L', '2,-1', '2,1', '', 'L', '8,-1', '8,1', '')
    ed.doc.add({
      kind: 'point',
      handle: ed.doc.newHandle(),
      layer: '0',
      color: 256,
      linetype: 'ByLayer',
      p: P(5, 0.03),
    })
    type(ed, 'TR')
    click(ed, P(5, 0.02))
    ed.submit('')
    expect(ed.state.history).not.toContain('Cannot trim that object.')
    const along = lines(ed).filter((l) => l.a.y === 0 && l.b.y === 0)
    expect(along).toHaveLength(2)
    expectLine(along[0], 0, 0, 2, 0)
    expectLine(along[1], 8, 0, 10, 0)
  })

  it('still says why when the only thing under the pick is refused', () => {
    const ed = editor()
    ed.doc.add({
      kind: 'point',
      handle: ed.doc.newHandle(),
      layer: '0',
      color: 256,
      linetype: 'ByLayer',
      p: P(5, 5),
    })
    type(ed, 'TR')
    click(ed, P(5, 5))
    expect(ed.state.history.at(-1)).toBe('Cannot trim that object.')
    click(ed, P(15, 15))
    expect(ed.state.history.at(-1)).toBe('No object found there.')
  })
})

describe('the first fit', () => {
  it('waits for a real window size before fitting the drawing', () => {
    const ed = new Editor()
    ed.doc.add(ed.doc.create({ kind: 'line', a: { x: 1000, y: 1000 }, b: { x: 1200, y: 1100 } }))
    // A window not laid out yet.
    ed.resize(0, 0)
    ed.resize(800, 600)
    const s = ed.view.toScreen({ x: 1100, y: 1050 })
    expect(s.x).toBeCloseTo(400, 6)
    expect(s.y).toBeCloseTo(300, 6)
  })
})
