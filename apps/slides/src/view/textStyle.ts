/**
 * CSS for slide text, shared by the drawn view (React) and the in-place text
 * editor (DOM it builds once). Values carry their units so the same records
 * work as React style objects and as `element.style` assignments.
 *
 * Sizes: a point is 12700 EMU, so a run of `s` points is `s × 12700 × scale`
 * pixels, where `scale` is pixels per EMU.
 */
import { css } from '../engine/color'
import type { Bullet, Paragraph, RunStyle, TextBody } from '../engine/model'

export const EMU_PER_PT = 12700

/** Metric-compatible fallbacks for the fonts decks use most, then a generic family. */
const FALLBACKS: Record<string, string> = {
  calibri: 'Carlito',
  'calibri light': 'Carlito',
  cambria: 'Caladea',
  arial: 'Liberation Sans, Arimo, Helvetica',
  helvetica: 'Arial, Liberation Sans',
  'times new roman': 'Liberation Serif, Tinos, Times',
  'courier new': 'Liberation Mono, Cousine, Courier',
  georgia: 'Gelasio',
  verdana: 'DejaVu Sans',
  tahoma: 'DejaVu Sans',
  'segoe ui': 'Selawik, Open Sans',
}

const SERIF = /times|serif|georgia|garamond|cambria|book|palatino|caladea|baskerville|didot|bodoni/i
const MONO = /courier|mono|consol/i

export function fontStack(name: string): string {
  const clean = name.replace(/["\\]/g, '')
  const fb = FALLBACKS[clean.toLowerCase()]
  const generic = MONO.test(clean) ? 'monospace' : SERIF.test(clean) ? 'serif' : 'sans-serif'
  const quote = (f: string) => `"${f.trim()}"`
  return [quote(clean), ...(fb ? fb.split(',').map(quote) : []), generic].join(', ')
}

export type Css = Record<string, string>

export function runCss(style: RunStyle, scale: number, fontScale: number): Css {
  let size = style.sizePt * fontScale * EMU_PER_PT * scale
  const out: Css = {
    fontFamily: fontStack(style.font || 'Calibri'),
    color: css(style.color),
  }
  if (style.baseline !== 0) {
    size *= 0.67
    out.verticalAlign = style.baseline > 0 ? 'super' : 'sub'
  }
  out.fontSize = `${round(size)}px`
  out.fontWeight = style.bold ? '700' : '400'
  out.fontStyle = style.italic ? 'italic' : 'normal'
  const deco = [style.underline ? 'underline' : '', style.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')
  out.textDecorationLine = deco || 'none'
  if (style.caps === 'all') out.textTransform = 'uppercase'
  if (style.caps === 'small') out.fontVariant = 'small-caps'
  if (style.highlight) out.backgroundColor = css(style.highlight)
  return out
}

const round = (n: number) => Math.round(n * 100) / 100

/** The CSS of a paragraph block; `first` drops its space before, as PowerPoint does. */
export function paragraphCss(p: Paragraph, body: TextBody, scale: number, first: boolean): Css {
  const firstRun = p.runs.find((r) => r.kind !== 'br')
  const basePx = (firstRun?.style.sizePt ?? p.endStyle.sizePt) * body.fontScale * EMU_PER_PT * scale
  const out: Css = {
    textAlign:
      p.align === 'ctr'
        ? 'center'
        : p.align === 'r'
          ? 'right'
          : p.align === 'just' || p.align === 'dist'
            ? 'justify'
            : 'left',
    paddingLeft: `${round(p.marL * scale)}px`,
    textIndent: `${round(p.indent * scale)}px`,
    direction: p.rtl ? 'rtl' : 'ltr',
    // The empty-paragraph and typed-text style lives on the block itself.
    ...runCss(p.endStyle, scale, body.fontScale),
  }
  delete out.verticalAlign
  if (p.align === 'dist') out.textAlignLast = 'justify'
  const ls = p.lineSpacing
  if (ls.pts !== undefined) out.lineHeight = `${round(ls.pts * EMU_PER_PT * scale)}px`
  else out.lineHeight = String(round(1.2 * Math.max(0.1, (ls.pct ?? 1) - body.lineReduction)))
  const space = (s: Paragraph['spaceBefore']) =>
    s.pts !== undefined
      ? s.pts * EMU_PER_PT * scale
      : s.pct !== undefined
        ? s.pct * basePx * 1.2
        : 0
  if (!first) out.marginTop = `${round(space(p.spaceBefore))}px`
  out.marginBottom = `${round(space(p.spaceAfter))}px`
  return out
}

/** The CSS of a text box's container (insets, anchoring, wrapping, direction). */
export function bodyCss(body: TextBody, scale: number): Css {
  const out: Css = {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    justifyContent:
      body.anchor === 'ctr' ? 'center' : body.anchor === 'b' ? 'flex-end' : 'flex-start',
    paddingLeft: `${round(body.insets.l * scale)}px`,
    paddingRight: `${round(body.insets.r * scale)}px`,
    paddingTop: `${round(body.insets.t * scale)}px`,
    paddingBottom: `${round(body.insets.b * scale)}px`,
    whiteSpace: body.wrap ? 'pre-wrap' : 'pre',
    overflowWrap: body.wrap ? 'break-word' : 'normal',
    boxSizing: 'border-box',
    overflow: 'visible',
  }
  if (body.vert === 'vert' || body.vert === 'eaVert' || body.vert === 'wordArtVertRtl')
    out.writingMode = 'vertical-rl'
  if (body.vert === 'vert270') {
    out.writingMode = 'vertical-rl'
    out.transform = 'rotate(180deg)'
  }
  return out
}

export function bulletCss(b: Bullet, p: Paragraph, body: TextBody, scale: number): Css {
  const run = p.runs.find((r) => r.kind !== 'br')
  const style = run?.style ?? p.endStyle
  const out = runCss(style, scale, body.fontScale * b.sizePct)
  // Symbol-font bullets are drawn as the Unicode character they stand for, in the run's font.
  if (b.font && !/wingdings|webdings|symbol/i.test(b.font)) out.fontFamily = fontStack(b.font)
  if (b.color) out.color = css(b.color)
  out.fontWeight = style.bold ? '700' : '400'
  out.fontStyle = 'normal'
  out.textDecorationLine = 'none'
  out.display = 'inline-block'
  out.textIndent = '0'
  const hang = -p.indent * scale
  out.minWidth = `${round(Math.max(0, hang))}px`
  if (hang <= 0) out.paddingRight = '0.4em'
  return out
}

/** The text a bullet shows. Symbol-font bullets map to the Unicode they stand for. */
export function bulletText(b: Bullet): string {
  if (b.kind === 'number') return b.text
  const font = (b.font ?? '').toLowerCase()
  if (font.includes('wingdings')) {
    const map: Record<string, string> = {
      '§': '■',
      l: '●',
      n: '■',
      q: '❑',
      v: '❖',
      Ø: '➢',
      ü: '✓',
      Ÿ: '•',
      o: '○',
      p: '□',
      u: '◆',
      è: '➔',
    }
    return map[b.char] ?? '•'
  }
  if (font.includes('symbol')) return b.char === '·' ? '•' : b.char
  return b.char
}
