/**
 * What Slides opens, and how it says no. Decided from the name before a byte
 * is read (as the OS's Docs refuses `.doc`), then from the first bytes: a
 * `.pptx` that is really an OLE2 file is an old-format or password-protected
 * deck under the wrong name.
 */

/** Zip-based PowerPoint files this app reads and saves in place. */
const OPENS = new Set(['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'])

const KNOWN: Record<string, string> = {
  ppt: 'PowerPoint 97-2003 (.ppt)',
  pps: 'PowerPoint 97-2003 slide show (.pps)',
  pot: 'PowerPoint 97-2003 template (.pot)',
  odp: 'OpenDocument Presentation (.odp)',
  otp: 'OpenDocument template (.otp)',
  key: 'Apple Keynote (.key)',
}

const OTHER_APPS: Record<string, string> = {
  docx: 'Docs',
  doc: 'Docs',
  xlsx: 'Sheets',
  xls: 'Sheets',
  csv: 'Sheets',
  pdf: 'PDF',
  txt: 'Notepad',
  md: 'Markdown Editor',
}

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** Why Slides will not open `path`, or null when it will. */
export function unsupportedReason(path: string): string | null {
  const ext = extensionOf(path)
  if (OPENS.has(ext)) return null
  const known = KNOWN[ext]
  if (known) return `${known} is not supported. Slides reads .pptx files.`
  const other = OTHER_APPS[ext]
  if (other) return `.${ext} files open in ${other}. Slides reads .pptx files.`
  if (!ext) return 'This file has no extension. Slides reads .pptx files.'
  return `.${ext} is not supported. Slides reads .pptx files.`
}

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** A reason from the first bytes, or null when they look like a zip package. */
export function sniffReason(bytes: Uint8Array): string | null {
  if (OLE2.every((b, i) => bytes[i] === b)) {
    return 'This file is a password-protected presentation or a PowerPoint 97-2003 file named .pptx. Slides reads unprotected .pptx files.'
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return 'This file is not a readable .pptx package.'
  return null
}
