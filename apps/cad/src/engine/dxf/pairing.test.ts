import { describe, expect, it, vi } from 'vitest'
import { readDxf } from './read'
import { writeDxf } from './write'

// A parser that silently skips the first LINE it meets, as a parser can on a record it cannot read.
vi.mock('dxf-viewer/src/parser/DxfParser.js', async (importOriginal) => {
  const Real = (
    await importOriginal<{
      default: new () => { parseSync(t: string): { entities: { type: string }[] } }
    }>()
  ).default
  return {
    default: class {
      parseSync(text: string) {
        const dxf = new Real().parseSync(text)
        let dropped = false
        dxf.entities = dxf.entities.filter((e) => {
          if (!dropped && e.type === 'LINE') {
            dropped = true
            return false
          }
          return true
        })
        return dxf
      }
    },
  }
})

const DXF = [
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'LINE',
  '5',
  'A1',
  '8',
  '0',
  '10',
  '1',
  '20',
  '2',
  '30',
  '0',
  '11',
  '3',
  '21',
  '4',
  '31',
  '0',
  '0',
  'LINE',
  '5',
  'A2',
  '8',
  '0',
  '10',
  '5',
  '20',
  '6',
  '30',
  '0',
  '11',
  '7',
  '21',
  '8',
  '31',
  '0',
  '0',
  'ENDSEC',
  '0',
  'EOF',
  '',
].join('\n')

describe('pairing raw records with parsed entities', () => {
  it('never gives a record another entity’s geometry when the parser skips one', () => {
    const { doc } = readDxf(new TextEncoder().encode(DXF))
    const [first, second] = doc.all()
    // The skipped record keeps its own group codes and is written back with them.
    expect(first.kind).toBe('foreign')
    expect(first.handle).toBe('A1')
    expect(second.kind === 'line' && [second.handle, second.a, second.b]).toEqual([
      'A2',
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ])
    const out = writeDxf(doc).text
    expect(out).toMatch(/\n10\n1\n20\n2\n/)
    expect(out).toMatch(/\n11\n3\n21\n4\n/)
  })
})
