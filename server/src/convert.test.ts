import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createConverter } from './convert.ts'

const standIn = new URL('./__fixtures__/standInConverter.ts', import.meta.url)
const bytes = (s: string) => new TextEncoder().encode(s)
const quiet = () => undefined

describe('createConverter (a child process per file)', () => {
  it('answers what the child answers', async () => {
    const convert = createConverter({ entry: standIn, log: quiet })
    const result = await convert(bytes('AC1032 drawing'))
    expect(result.ok && new TextDecoder().decode(result.dxf)).toBe('AC1032 drawing')
  })

  it('kills a conversion that runs past the limit', async () => {
    const convert = createConverter({ entry: standIn, timeoutMs: 1500, log: quiet })
    const started = Date.now()
    expect(await convert(bytes('hang'))).toEqual({ ok: false, error: 'timeout' })
    expect(Date.now() - started).toBeLessThan(5000)
    // The next one runs: the stuck child is gone.
    expect((await convert(bytes('AC1032'))).ok).toBe(true)
  })

  it('reports a child that fails or dies as unreadable', async () => {
    const convert = createConverter({ entry: standIn, log: quiet })
    expect(await convert(bytes('error'))).toEqual({ ok: false, error: 'unreadable' })
    expect(await convert(bytes('xit'))).toEqual({ ok: false, error: 'unreadable' })
  })

  it('runs one at a time and refuses past the queue', async () => {
    const convert = createConverter({ entry: standIn, timeoutMs: 1500, maxWaiting: 2, log: quiet })
    const first = convert(bytes('hang'))
    const second = convert(bytes('AC1 second'))
    expect(await convert(bytes('AC1 third'))).toEqual({ ok: false, error: 'busy' })
    expect(await first).toEqual({ ok: false, error: 'timeout' })
    expect((await second).ok).toBe(true)
  })
})

describe('the real converter (LibreDWG as WebAssembly)', () => {
  it('says a DWG it cannot read is unreadable, without taking the server down', async () => {
    const convert = createConverter({ log: quiet })
    expect(await convert(bytes('AC1032 and nothing a reader could use'))).toEqual({
      ok: false,
      error: 'unreadable',
    })
  }, 30_000)

  // Real drawings are not committed (see corpus/wiki/test-files.md): set
  // DWG_FIXTURES to a folder of .dwg files to convert each one.
  const dir = process.env.DWG_FIXTURES
  it.skipIf(!dir)(
    'converts every DWG in DWG_FIXTURES to a DXF',
    async () => {
      const convert = createConverter({ log: quiet })
      for (const name of readdirSync(dir!).filter((f) => /\.dwg$/i.test(f))) {
        const result = await convert(new Uint8Array(readFileSync(join(dir!, name))))
        expect(result.ok, name).toBe(true)
        const dxf = gunzipSync(result.ok ? result.dxf : new Uint8Array()).toString('latin1')
        // LibreDWG signs it with a 999 comment first.
        expect(dxf, name).toMatch(/^(999\r?\n.*\r?\n)?\s*0\r?\nSECTION/)
        expect(dxf.trimEnd(), name).toMatch(/EOF$/)
      }
    },
    120_000
  )
})
