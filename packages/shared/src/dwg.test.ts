import { describe, expect, it } from 'vitest'
import { dwgRelease, dwgVersion } from './dwg'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('dwgVersion and dwgRelease', () => {
  it('reads the version code a DWG starts with', () => {
    expect(dwgVersion(bytes('AC1015\0\0\0'))).toBe('AC1015')
    expect(dwgVersion(bytes('AC1032rest'))).toBe('AC1032')
    expect(dwgVersion(bytes('AC1.50\x01'))).toBe('AC1.50')
    expect(dwgRelease('AC1015')).toBe('AutoCAD 2000')
    expect(dwgRelease('AC1021')).toBe('AutoCAD 2007')
    expect(dwgRelease('AC1032')).toBe('AutoCAD 2018')
    expect(dwgRelease('AC1099')).toBe('AC1099')
  })

  it('says null for what does not start like a DWG', () => {
    expect(dwgVersion(bytes('  0\nSECTION'))).toBeNull()
    expect(dwgVersion(bytes('PK\x03\x04'))).toBeNull()
    expect(dwgVersion(new Uint8Array())).toBeNull()
  })
})
