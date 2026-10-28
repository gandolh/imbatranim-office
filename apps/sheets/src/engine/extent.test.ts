import { describe, expect, it } from 'vitest'
import type { IWorkbookData, IWorksheetData } from '@univerjs/presets'
import { referencedCells, sheetSize } from './extent'
import { parse } from './xlsxMapping'
import { csvToUniver } from './csv'

/**
 * Brief 15: Univer gives a sheet 1,000 rows unless told otherwise, and a
 * single-cell reference past the sheet's edge computes #NAME?, which a save
 * then writes as the cached value. These tests pin the sizes the mappings
 * give, and then run the formulas in a headless Univer to show they compute.
 */

const at = (row: number, column: number, sheet?: string) =>
  sheet === undefined ? { row, column } : { sheet, row, column }

describe('referencedCells', () => {
  it('finds plain, absolute and other-sheet references, 0-based', () => {
    expect(referencedCells('=A1001*2')).toEqual([at(1000, 0)])
    expect(referencedCells('=$B$7+C$8')).toEqual([at(6, 1), at(7, 2)])
    expect(referencedCells('=Sheet2!A2000+1')).toEqual([at(1999, 0, 'Sheet2')])
    expect(referencedCells("='My Sheet'!C3")).toEqual([at(2, 2, 'My Sheet')])
    expect(referencedCells("='It''s'!D4")).toEqual([at(3, 3, "It's")])
    expect(referencedCells('=Situație!B2')).toEqual([at(1, 1, 'Situație')])
  })

  it('leaves out ranges, which Univer computes past the edge', () => {
    expect(referencedCells('=SUM(A1:A5000)')).toEqual([])
    expect(referencedCells('=SUM(Sheet2!$A$1:$B$900)+C2')).toEqual([at(1, 2)])
    expect(referencedCells('=SUM(A:A)+SUM(3:3)')).toEqual([])
  })

  it('is not fooled by function names, numbers or string literals', () => {
    expect(referencedCells('=LOG10(A2)+ATAN2(B3,1)')).toEqual([at(1, 0), at(2, 1)])
    expect(referencedCells('=1E5+A1')).toEqual([at(0, 0)])
    expect(referencedCells('=INDIRECT("A5000")&"B9"')).toEqual([])
  })

  it('keeps to Excel’s grid', () => {
    expect(referencedCells('=XFD1048576')).toEqual([at(1_048_575, 16_383)])
    expect(referencedCells('=A1048577+XFE1+A0')).toEqual([])
  })
})

describe('sheetSize', () => {
  it('never goes under Univer’s 1,000 × 20', () => {
    expect(sheetSize(4, 2)).toEqual({ rowCount: 1000, columnCount: 20 })
    expect(sheetSize(1999, 25)).toEqual({ rowCount: 2000, columnCount: 26 })
  })
})

/** Calc: A{r} = r and B{r} = A{r}*2 for 1,500 rows, plus references past the data. */
async function workbookBytes(): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const calc = wb.addWorksheet('Calc')
  for (let r = 1; r <= 1500; r++) {
    calc.getCell(r, 1).value = r
    calc.getCell(r, 2).value = { formula: `A${r}*2` }
  }
  calc.getCell('C1').value = { formula: 'A5000' }
  calc.getCell('D1').value = { formula: 'AA1+1' }
  calc.getCell('E1').value = { formula: "'Other sheet'!B3000" }
  calc.getCell('F1').value = { formula: 'SUM(A1:A1500)' }
  const other = wb.addWorksheet('Other sheet')
  other.getCell('A1').value = 'tiny'
  const buf = await wb.xlsx.writeBuffer()
  return buf as ArrayBuffer
}

const sheetNamed = (wb: Partial<IWorkbookData>, name: string) =>
  Object.values(wb.sheets ?? {}).find((s) => s?.name === name) as Partial<IWorksheetData>

describe('the mappings size each sheet', () => {
  it('xlsx: room for the data and every cell a formula points at', async () => {
    const { workbook } = await parse(await workbookBytes())
    const calc = sheetNamed(workbook, 'Calc')
    expect(calc.rowCount).toBe(5000)
    expect(calc.columnCount).toBe(27)
    const other = sheetNamed(workbook, 'Other sheet')
    expect(other.rowCount).toBe(3000)
    expect(other.columnCount).toBe(20)
  })

  it('csv: room for every row', () => {
    const long = Array.from({ length: 1500 }, (_, i) => `${i + 1},x`).join('\n')
    const sheet = (text: string) => Object.values(csvToUniver(text).sheets ?? {})[0]
    expect(sheet(long)?.rowCount).toBe(1500)
    expect(sheet('a,b\n1,2')?.rowCount).toBe(1000)
  })
})

describe('in Univer, the formulas compute', () => {
  /** Run the workbook through a headless Univer (0.25.1's Node preset) and read the results. */
  async function compute(data: Partial<IWorkbookData>) {
    const { createUniver, LocaleType, merge } = await import('@univerjs/presets')
    const { UniverSheetsNodeCorePreset } = await import('@univerjs/presets/preset-sheets-node-core')
    const enUS = (await import('@univerjs/presets/preset-sheets-node-core/locales/en-US')).default
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: merge({}, enUS) },
      presets: [UniverSheetsNodeCorePreset()],
    })
    try {
      const wb = univerAPI.createWorkbook(data)
      await univerAPI.getFormula().onCalculationResultApplied(30_000)
      const saved = wb.save()
      const calc = Object.values(saved.sheets).find((s) => s.name === 'Calc')!
      return (a1: string) => {
        const m = /^([A-Z]+)(\d+)$/.exec(a1)!
        const column = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
        return calc.cellData?.[Number(m[2]) - 1]?.[column]?.v
      }
    } finally {
      univer.dispose()
    }
  }

  it('past row 1000, and where a reference points past the data', async () => {
    const { workbook } = await parse(await workbookBytes())
    const v = await compute(workbook)
    expect(v('B1000')).toBe(2000)
    expect(v('B1001')).toBe(2002)
    expect(v('B1500')).toBe(3000)
    // Empty cells, as Excel computes them.
    expect(v('C1')).toBe(0)
    expect(v('D1')).toBe(1)
    expect(v('E1')).toBe(0)
    expect(v('F1')).toBe(1125750)
  }, 60_000)

  it('control: without the sizes, Univer computes #NAME? (the bug)', async () => {
    const { workbook } = await parse(await workbookBytes())
    for (const sheet of Object.values(workbook.sheets ?? {})) {
      delete sheet!.rowCount
      delete sheet!.columnCount
    }
    const v = await compute(workbook)
    expect(v('B1000')).toBe(2000)
    expect(v('B1001')).toBe('#NAME?')
  }, 60_000)
})
