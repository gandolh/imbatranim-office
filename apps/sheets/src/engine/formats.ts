/**
 * What Sheets opens, and how it says no.
 *
 * ExcelJS reads the zip-based workbook and nothing else. Handed an Excel
 * 97-2003 `.xls` (an OLE2 file), it does not fail: it loads a workbook with no
 * sheets, the window showed an empty grid, and a save wrote an `.xlsx` over
 * the old file. Found in brief 08's walk, in the built-in as well. So the
 * refusal comes first, from the name before a byte is read, then from the
 * first bytes for a file that is not a zip under an `.xlsx` name.
 */

/** Read by ExcelJS (zip packages) or by the CSV parser. */
const OPENS = new Set(['xlsx', 'xlsm', 'csv'])

/** Spreadsheet formats a user might expect to open here. */
const KNOWN: Record<string, string> = {
  xls: 'Excel 97-2003 (.xls)',
  xlt: 'Excel 97-2003 template (.xlt)',
  xlsb: 'Excel binary workbook (.xlsb)',
  ods: 'OpenDocument Spreadsheet (.ods)',
  ots: 'OpenDocument template (.ots)',
  numbers: 'Apple Numbers (.numbers)',
}

/** Formats another app in the OS owns: point at it rather than just refusing. */
const OTHER_APPS: Record<string, string> = {
  docx: 'Docs',
  doc: 'Docs',
  pptx: 'Slides',
  ppt: 'Slides',
  pdf: 'PDF',
  dxf: 'CAD',
  txt: 'Notepad',
  md: 'Markdown Editor',
}

const READS = 'Sheets reads .xlsx and .csv files.'

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** Why Sheets will not open `path`, or null when it will. */
export function unsupportedReason(path: string): string | null {
  const ext = extensionOf(path)
  if (OPENS.has(ext)) return null
  const known = KNOWN[ext]
  if (known) return `${known} is not supported. ${READS}`
  const other = OTHER_APPS[ext]
  if (other) return `.${ext} files open in ${other}. ${READS}`
  if (!ext) return `This file has no extension. ${READS}`
  return `.${ext} is not supported. ${READS}`
}

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** For a workbook (not a CSV): a reason from the first bytes, or null when they look like a zip. */
export function sniffReason(bytes: Uint8Array): string | null {
  if (OLE2.every((b, i) => bytes[i] === b)) {
    return 'This file is a password-protected workbook or an Excel 97-2003 file named .xlsx. Sheets reads unprotected .xlsx files.'
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return 'This file is not a readable .xlsx package.'
  return null
}
