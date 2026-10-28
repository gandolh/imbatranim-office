/**
 * How many rows and columns a sheet gets in Univer.
 *
 * A Univer sheet is `rowCount` × `columnCount` cells, 1,000 × 20 when unset,
 * and a single-cell reference outside it is not a reference: `=A1001*2`
 * computes `#NAME?`, and a save writes that as the cell's cached value.
 * Ranges are not affected; Univer computes `SUM(A1:A5000)` past the edge.
 * Excel's grid is 1,048,576 × 16,384, so every reference in a file it wrote is
 * in range there (brief 15).
 *
 * So a sheet gets room for its own data and for every cell a formula anywhere
 * in the workbook points at, with Univer's default as the floor. Not Excel's
 * whole grid: Univer lays out every row and column of the sheet.
 *
 * Plain functions over strings, no Univer import: the xlsx worker runs this.
 */

/** Univer's own size for a sheet that does not give one. */
export const DEFAULT_ROWS = 1000
export const DEFAULT_COLUMNS = 20
/** Excel's grid. A reference past it is a name, in Excel and in Univer. */
const EXCEL_ROWS = 1_048_576
const EXCEL_COLUMNS = 16_384

const STRING_LITERAL = /"(?:[^"]|"")*"/g

/**
 * An optional sheet (quoted, or a bare name), a cell, and an optional range
 * end. The lookbehind keeps it out of a longer name or number (`LOG10`, `1E5`)
 * and off the far end of a range; the lookahead refuses a function call
 * (`ATAN2(`) and a longer name.
 */
const REFERENCE =
  /(?<![\p{L}\p{N}_.$'!:])(?:('(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_.]*)!)?\$?([A-Za-z]{1,3})\$?(\d+)(:\$?[A-Za-z]{1,3}\$?\d+)?(?![\p{L}\p{N}_.(!:])/gu

/** A cell a formula points at: 0-based, on `sheet` (as named) or its own sheet. */
export type ReferencedCell = { sheet?: string; row: number; column: number }

function columnIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

/**
 * The cells a formula's single-cell references point at. Ranges are left
 * out (Univer computes them past the sheet's edge), and so is anything inside
 * a string literal (`INDIRECT("A5000")` cannot be known without running it).
 */
export function referencedCells(formula: string): ReferencedCell[] {
  const out: ReferencedCell[] = []
  const text = formula.replace(STRING_LITERAL, '""')
  for (const m of text.matchAll(REFERENCE)) {
    const [, sheet, letters, digits, rangeEnd] = m
    if (rangeEnd) continue
    const row = Number(digits) - 1
    const column = columnIndex(letters)
    if (row < 0 || row >= EXCEL_ROWS || column >= EXCEL_COLUMNS) continue
    const name = sheet?.startsWith("'") ? sheet.slice(1, -1).replace(/''/g, "'") : sheet
    out.push(name === undefined ? { row, column } : { sheet: name, row, column })
  }
  return out
}

/** Univer's `rowCount` and `columnCount` for a sheet whose furthest cell is given (0-based). */
export function sheetSize(
  lastRow: number,
  lastColumn: number
): { rowCount: number; columnCount: number } {
  return {
    rowCount: Math.max(lastRow + 1, DEFAULT_ROWS),
    columnCount: Math.max(lastColumn + 1, DEFAULT_COLUMNS),
  }
}

/**
 * The furthest cell each sheet of a workbook must hold, by sheet name. Names
 * compare without case, as Excel's do.
 */
export class SheetExtents {
  private readonly far = new Map<string, { row: number; column: number }>()

  /** Note a cell (0-based) that `sheet` must hold. */
  include(sheet: string, row: number, column: number): void {
    const key = sheet.toLowerCase()
    const f = this.far.get(key)
    if (!f) this.far.set(key, { row, column })
    else {
      if (row > f.row) f.row = row
      if (column > f.column) f.column = column
    }
  }

  /** Note every cell a formula on `sheet` points at. */
  includeReferences(sheet: string, formula: string): void {
    for (const c of referencedCells(formula)) this.include(c.sheet ?? sheet, c.row, c.column)
  }

  /** `rowCount` and `columnCount` for `sheet`. */
  size(sheet: string): { rowCount: number; columnCount: number } {
    const f = this.far.get(sheet.toLowerCase())
    return sheetSize(f?.row ?? 0, f?.column ?? 0)
  }
}
