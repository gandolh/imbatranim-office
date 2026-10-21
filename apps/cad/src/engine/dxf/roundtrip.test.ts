/// <reference types="node" />
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CadDocument } from '../model/document'
import type { Entity } from '../model/types'
import { readDxf } from './read'
import { writeDxfBytes } from './write'

const FIXTURES = join(import.meta.dirname, '../../../fixtures')
/** Larger real drawings that are not committed: set CAD_FIXTURES to a folder holding them. */
const EXTRA = process.env.CAD_FIXTURES

/** Numbers to 12 significant digits: angles go through degrees in the file. */
function rounded(v: unknown): unknown {
  if (typeof v === 'number') return Number(v.toPrecision(12))
  if (Array.isArray(v)) return v.map(rounded)
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]))
  return v
}

/** An entity without what a save renumbers. */
function comparable(e: Entity): unknown {
  return rounded(comparableRaw(e))
}

function comparableRaw(e: Entity): unknown {
  const { handle: _h, ...rest } = e as Entity & { attribs?: { handle: string }[] }
  if (e.kind === 'insert') {
    return { ...rest, attribs: e.attribs.map(({ handle: _a, ...a }) => a) }
  }
  if (e.kind === 'foreign') {
    // Handles, owners and reactors are rewritten; the rest of the record must survive.
    return {
      ...rest,
      tags: e.tags.filter(
        ([c]) => c !== 5 && !(c >= 330 && c <= 369) && c !== 102 && c !== 97 && c !== 71
      ),
    }
  }
  return rest
}

function roundTrip(bytes: Uint8Array) {
  const first = readDxf(bytes)
  const saved = writeDxfBytes(first.doc)
  const second = readDxf(saved.bytes)
  return { first, saved, second }
}

function expectSameDrawing(a: CadDocument, b: CadDocument) {
  const ea = a.all().map(comparable)
  const eb = b.all().map(comparable)
  expect(eb.length).toBe(ea.length)
  for (let i = 0; i < ea.length; i++) expect(eb[i]).toEqual(ea[i])
  expect([...b.layers.values()]).toEqual([...a.layers.values()])
  expect([...b.blocks.keys()].sort()).toEqual([...a.blocks.keys()].sort())
  for (const [name, block] of a.blocks) {
    const other = b.blocks.get(name)!
    expect(other.base).toEqual(block.base)
    expect(other.entities.map(comparable)).toEqual(block.entities.map(comparable))
  }
  expect(b.units).toEqual(a.units)
}

describe('DXF round trip', () => {
  it('reads apartment.dxf with every entity, foreign ones included', () => {
    const { doc, report } = readDxf(readFileSync(join(FIXTURES, 'apartment.dxf')))
    expect(report.counts).toEqual({
      HATCH: 5,
      LWPOLYLINE: 22,
      LINE: 7,
      ARC: 2,
      CIRCLE: 8,
      ELLIPSE: 1,
      MTEXT: 4,
      LEADER: 1,
      ACAD_TABLE: 1,
      DIMENSION: 7,
    })
    expect(report.foreign).toEqual({ HATCH: 5, LEADER: 1, ACAD_TABLE: 1, DIMENSION: 7 })
    expect(doc.layers.size).toBe(9)
  })

  it('writes apartment.dxf back with nothing lost', () => {
    const { first, saved, second } = roundTrip(readFileSync(join(FIXTURES, 'apartment.dxf')))
    expect(saved.report.dropped).toEqual({})
    expect(saved.report.converted).toEqual({ ACAD_TABLE: 1 })
    expect(saved.report.kept).toEqual({ HATCH: 5, LEADER: 1, DIMENSION: 7 })
    // The table comes back as a reference to its block, which draws the same.
    const firstNoTable = first.doc
      .all()
      .filter((e) => !(e.kind === 'foreign' && e.type === 'ACAD_TABLE'))
    const secondNoTable = second.doc
      .all()
      .filter((e) => !(e.kind === 'insert' && e.block.startsWith('*T')))
    expect(secondNoTable.map(comparable)).toEqual(firstNoTable.map(comparable))
    expect(second.doc.all().filter((e) => e.kind === 'insert')).toHaveLength(1)
  })

  it('keeps every modelled kind with its layer, colour, linetype and coordinates', () => {
    const doc = new CadDocument({
      layers: [
        {
          name: '0',
          color: 7,
          linetype: 'Continuous',
          lineweight: -3,
          on: true,
          frozen: false,
          locked: false,
        },
        {
          name: 'WALLS',
          color: 1,
          linetype: 'DASHED',
          lineweight: 50,
          on: true,
          frozen: false,
          locked: true,
        },
        {
          name: 'OFF',
          color: 3,
          rgb: 0x123456,
          linetype: 'Continuous',
          lineweight: -3,
          on: false,
          frozen: true,
          locked: false,
        },
      ],
      linetypes: [{ name: 'DASHED', description: '__ __', pattern: [0.5, -0.25] }],
      blocks: [
        {
          name: 'DOOR',
          base: { x: 1, y: 2 },
          flags: 0,
          entities: [
            {
              handle: '30',
              layer: '0',
              color: 0,
              linetype: 'ByBlock',
              kind: 'line',
              a: { x: 1, y: 2 },
              b: { x: 2, y: 3 },
            },
          ],
        },
      ],
      units: { system: 'architectural', precision: 4, metricUnit: 'mm' },
    })
    const p = { layer: 'WALLS', color: 256, linetype: 'ByLayer' }
    doc.add(
      {
        ...p,
        handle: '100',
        kind: 'line',
        a: { x: 0.1, y: -2.5 },
        b: { x: 1e6 + 0.123456789, y: 7 },
      },
      { ...p, handle: '101', kind: 'circle', c: { x: 3, y: 4 }, r: 2.5, color: 5 },
      { ...p, handle: '102', kind: 'arc', c: { x: -1, y: 1 }, r: 1, start: 0.5, end: 4 },
      {
        ...p,
        handle: '103',
        kind: 'polyline',
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 0.5 },
          { x: 10, y: 8, bulge: -1 },
        ],
        closed: true,
        width: 0,
        linetype: 'DASHED',
        lineweight: 35,
      },
      {
        ...p,
        handle: '104',
        kind: 'text',
        position: { x: 1, y: 1 },
        height: 2.5,
        rotation: Math.PI / 6,
        value: 'Kitchen',
        style: 'Standard',
        halign: 1,
        valign: 2,
        alignPoint: { x: 4, y: 2 },
        widthFactor: 0.8,
        rgb: 0xff8800,
      },
      {
        ...p,
        handle: '105',
        kind: 'mtext',
        position: { x: 5, y: 5 },
        height: 1,
        width: 12,
        attachment: 5,
        rotation: 0.25,
        value: `First line\\P${'x'.repeat(600)}`,
        style: 'Standard',
      },
      {
        ...p,
        handle: '106',
        kind: 'insert',
        block: 'DOOR',
        position: { x: 20, y: 0 },
        sx: 2,
        sy: -1,
        rotation: Math.PI / 2,
        attribs: [],
      },
      {
        ...p,
        handle: '107',
        kind: 'ellipse',
        c: { x: 0, y: 0 },
        major: { x: 3, y: 1 },
        ratio: 0.5,
        start: 0,
        end: Math.PI,
      },
      { ...p, handle: '108', kind: 'point', p: { x: 9, y: 9 }, layer: 'OFF' }
    )
    const second = readDxf(writeDxfBytes(doc).bytes).doc
    expectSameDrawing(doc, second)
  })

  it('keeps extended data on modelled entities', () => {
    const doc = new CadDocument()
    doc.add({
      handle: '100',
      layer: '0',
      color: 256,
      linetype: 'ByLayer',
      kind: 'line',
      a: { x: 0, y: 0 },
      b: { x: 1, y: 1 },
      xdata: [
        [1001, 'MYAPP'],
        [1000, 'hello'],
        [1002, '{'],
        [1070, '7'],
        [1040, '2.5'],
        [1002, '}'],
      ],
    })
    const back = readDxf(writeDxfBytes(doc).bytes).doc.all()[0]
    expect(back.xdata?.map(([c, v]) => [c, v.trim()])).toEqual([
      [1001, 'MYAPP'],
      [1000, 'hello'],
      [1002, '{'],
      [1070, '7'],
      [1040, '2.5'],
      [1002, '}'],
    ])
  })

  for (const name of ['0040000C01.DXF', '3_us_main.dxf']) {
    const path = EXTRA ? join(EXTRA, name) : ''
    it.skipIf(!EXTRA || !existsSync(path))(`round-trips ${name} (CAD_FIXTURES)`, () => {
      const { first, saved, second } = roundTrip(readFileSync(path))
      expect(saved.report.dropped).toEqual({})
      expectSameDrawing(first.doc, second.doc)
    })
  }
})
