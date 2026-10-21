import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { listEntries, NotAZipError, PackageTooLargeError, readZip, writeZip } from './zip'

describe('the zip layer', () => {
  it('reads entries in the package order and writes them back with the same content', () => {
    const zip = zipSync({
      'b.xml': strToU8('<b/>'),
      'a.png': strToU8('PNG'),
      'dir/c.xml': strToU8('<c/>'),
    })
    const { names, files } = readZip(zip)
    expect(names).toEqual(['b.xml', 'a.png', 'dir/c.xml'])
    const again = readZip(writeZip(names.map((n) => [n, files.get(n)!])))
    expect(again.names).toEqual(names)
    for (const n of names) expect(again.files.get(n)).toEqual(files.get(n))
  })

  it('refuses something that is not a zip', () => {
    expect(() => readZip(strToU8('not a zip at all, just text'))).toThrow(NotAZipError)
    expect(() => readZip(new Uint8Array(4))).toThrow(NotAZipError)
  })

  it('refuses a package with more entries than the limit, before inflating anything', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 30; i++) files[`f${i}.xml`] = strToU8('x')
    expect(() => listEntries(zipSync(files), { maxEntries: 20, maxTotalBytes: 1e9 })).toThrow(
      PackageTooLargeError
    )
  })

  it('refuses a package that claims to unpack to more than the limit (a zip bomb)', () => {
    const zip = zipSync({ 'big.xml': new Uint8Array(200_000) })
    expect(() => listEntries(zip, { maxEntries: 100, maxTotalBytes: 100_000 })).toThrow(
      PackageTooLargeError
    )
  })
})
