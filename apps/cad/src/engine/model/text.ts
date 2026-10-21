/**
 * Text layout shared by the renderer, hit testing and the exports: MTEXT
 * formatting codes reduced to plain lines, DXF special characters, and the
 * anchor a TEXT or MTEXT hangs from. Widths are estimates (0.6 of the height
 * per character); the drawing has no font metrics.
 */
import type { Vec } from '../geom/vec'
import type { MTextEntity, TextEntity } from './types'

export const CHAR_WIDTH = 0.6
/** AutoCAD's default MTEXT line spacing, as a multiple of the text height. */
export const LINE_SPACING = 5 / 3

/** `%%c` diameter, `%%d` degree, `%%p` plus-minus, `%%%` percent; `%%u`/`%%o` (underline/overline toggles) dropped. */
export function dxfSpecialChars(s: string): string {
  return s.replace(/%%([cdpuo%]|\d{3})/gi, (_m, code: string) => {
    const c = code.toLowerCase()
    if (c === 'c') return '⌀'
    if (c === 'd') return '°'
    if (c === 'p') return '±'
    if (c === '%') return '%'
    if (c === 'u' || c === 'o') return ''
    return String.fromCharCode(Number(code))
  })
}

/** An MTEXT value as plain lines: paragraph breaks kept, formatting dropped. */
export function mtextLines(value: string): string[] {
  let s = value
  // Stacked fractions \S1/2; → 1/2 (also ^ and # stack separators).
  s = s.replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, '$1/$2')
  // Codes with an argument up to ';': font, height, width, tracking, oblique, colour, alignment, paragraph.
  s = s.replace(/\\[FfHhWwTtQqCcAapP][^;\\]*;/g, (m) => (m === '\\P;' ? '\n' : ''))
  s = s.replace(/\\P/g, '\n').replace(/\\X/g, '\n')
  s = s.replace(/\\~/g, ' ')
  s = s.replace(/\\[LlOoKkNn]/g, '')
  s = s.replace(/\\U\+([0-9a-fA-F]{4})/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  )
  // Escaped braces and backslashes survive; bare grouping braces go.
  s = s.replace(/\\\\/g, '\uE000').replace(/\\\{/g, '\uE001').replace(/\\\}/g, '\uE002')
  s = s.replace(/[{}]/g, '')
  s = s
    .replace(/\uE000/g, '\\')
    .replace(/\uE001/g, '{')
    .replace(/\uE002/g, '}')
  s = s.replace(/\^I/g, '\t').replace(/\^J/g, '\n')
  return dxfSpecialChars(s).split('\n')
}

/** Wrap lines to a width, by estimated character width. */
export function wrapLines(lines: string[], width: number, height: number): string[] {
  if (width <= 0) return lines
  const maxChars = Math.max(1, Math.floor(width / (height * CHAR_WIDTH)))
  const out: string[] = []
  for (const line of lines) {
    if (line.length <= maxChars) {
      out.push(line)
      continue
    }
    let current = ''
    for (const word of line.split(' ')) {
      const next = current === '' ? word : `${current} ${word}`
      if (next.length > maxChars && current !== '') {
        out.push(current)
        current = word
      } else current = next
    }
    out.push(current)
  }
  return out
}

/** A laid-out run of text: one baseline-anchored line, in its own rotated frame. */
export type TextLine = {
  text: string
  /** Where the line's anchor sits, world coordinates. */
  at: Vec
  /** Canvas-style alignment of the line about `at`. */
  align: 'left' | 'center' | 'right'
  baseline: 'alphabetic' | 'bottom' | 'middle' | 'top'
  height: number
  rotation: number
  widthFactor: number
}

export function textLayout(e: TextEntity): TextLine[] {
  const text = dxfSpecialChars(e.value)
  const useAlign = (e.halign !== 0 || e.valign !== 0) && e.alignPoint !== undefined
  const at = useAlign && e.alignPoint ? e.alignPoint : e.position
  const align = e.halign === 1 || e.halign === 4 ? 'center' : e.halign === 2 ? 'right' : 'left'
  const baseline =
    e.halign === 4
      ? 'middle'
      : e.valign === 1
        ? 'bottom'
        : e.valign === 2
          ? 'middle'
          : e.valign === 3
            ? 'top'
            : 'alphabetic'
  return [
    {
      text,
      at,
      align,
      baseline,
      height: e.height,
      rotation: e.rotation,
      widthFactor: e.widthFactor,
    },
  ]
}

export function mtextLayout(e: MTextEntity): TextLine[] {
  const lines = wrapLines(mtextLines(e.value), e.width, e.height)
  const col = (e.attachment - 1) % 3
  const row = Math.floor((e.attachment - 1) / 3)
  const align = col === 0 ? 'left' : col === 1 ? 'center' : 'right'
  const step = e.height * LINE_SPACING
  const n = lines.length
  const total = e.height + step * (n - 1)
  const cs = Math.cos(e.rotation)
  const sn = Math.sin(e.rotation)
  return lines.map((text, i) => {
    // Baseline height of line i above the attachment point, in the text's own frame.
    const y =
      row === 0
        ? -e.height - step * i
        : row === 1
          ? total / 2 - e.height - step * i
          : step * (n - 1 - i)
    return {
      text,
      at: { x: e.position.x - sn * y, y: e.position.y + cs * y },
      align,
      baseline: 'alphabetic' as const,
      height: e.height,
      rotation: e.rotation,
      widthFactor: 1,
    }
  })
}

/** The four corners of a text line's box, world coordinates. */
export function lineBox(l: TextLine): Vec[] {
  const w = l.text.length * l.height * CHAR_WIDTH * l.widthFactor
  const x0 = l.align === 'left' ? 0 : l.align === 'center' ? -w / 2 : -w
  const y0 =
    l.baseline === 'alphabetic'
      ? -0.2 * l.height
      : l.baseline === 'bottom'
        ? 0
        : l.baseline === 'middle'
          ? -l.height / 2
          : -l.height
  const y1 = y0 + (l.baseline === 'alphabetic' ? 1.2 * l.height : l.height)
  const cs = Math.cos(l.rotation)
  const sn = Math.sin(l.rotation)
  return [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y1],
    [x0, y1],
  ].map(([x, y]) => ({ x: l.at.x + x * cs - y * sn, y: l.at.y + x * sn + y * cs }))
}
