import { describe, expect, it } from 'vitest'
import { extensionOf, sniffReason, unsupportedReason } from './formats'

describe('unsupportedReason', () => {
  it('opens workbooks and CSV files', () => {
    expect(unsupportedReason('Documents/book.xlsx')).toBeNull()
    expect(unsupportedReason('Documents/BOOK.XLSX')).toBeNull()
    expect(unsupportedReason('macros.xlsm')).toBeNull()
    expect(unsupportedReason('data.csv')).toBeNull()
  })

  it('refuses the old binary formats by name', () => {
    expect(unsupportedReason('Documents/maxindextest.xls')).toBe(
      'Excel 97-2003 (.xls) is not supported. Sheets reads .xlsx and .csv files.'
    )
    expect(unsupportedReason('budget.ods')).toContain('OpenDocument Spreadsheet')
    expect(unsupportedReason('fast.xlsb')).toContain('Excel binary workbook')
  })

  it('points at the app that opens another type', () => {
    expect(unsupportedReason('letter.docx')).toBe(
      '.docx files open in Docs. Sheets reads .xlsx and .csv files.'
    )
  })

  it('refuses a file with no or an unknown extension', () => {
    expect(unsupportedReason('README')).toContain('no extension')
    expect(unsupportedReason('table.tsv')).toBe(
      '.tsv is not supported. Sheets reads .xlsx and .csv files.'
    )
    expect(extensionOf('.hidden')).toBe('')
  })
})

describe('sniffReason', () => {
  it('passes a zip package', () => {
    expect(sniffReason(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull()
  })

  it('refuses an OLE2 file under a workbook name', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])
    expect(sniffReason(ole)).toContain('Excel 97-2003 file named .xlsx')
  })

  it('refuses anything else', () => {
    expect(sniffReason(new TextEncoder().encode('a,b\n1,2'))).toBe(
      'This file is not a readable .xlsx package.'
    )
    expect(sniffReason(new Uint8Array(0))).toBe('This file is not a readable .xlsx package.')
  })
})
