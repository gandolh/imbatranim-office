/**
 * In-place text editing: the shape's text is drawn into a contentEditable
 * block with the same CSS the view uses (textStyle.ts), the browser edits
 * it, and on commit the DOM is read back into paragraphs of runs.
 *
 * Each paragraph block carries `data-p` (the source paragraph's index) and
 * each run span `data-r` (its run index), so text the user left alone maps
 * back to its original run and keeps every property the editor does not
 * model; formatting the user applied is found by comparing the computed
 * style of each piece of text with the style its run had.
 */
import { css, rgbaToHex, type Rgba } from '../engine/color'
import type { Paragraph, Run, RunStyle, TextBody } from '../engine/model'
import type { EditParagraph, EditRun, RunFormat } from '../engine/textEdit'
import type { XmlElement } from '../engine/xml'
import {
  bodyCss,
  bulletCss,
  bulletText,
  EMU_PER_PT,
  paragraphCss,
  runCss,
  type Css,
} from './textStyle'

function setStyle(el: HTMLElement, style: Css): void {
  for (const [k, v] of Object.entries(style)) {
    ;(el.style as unknown as Record<string, string>)[k] = v
  }
}

/** Build the editable DOM for a text body. Empty bodies get one empty paragraph. */
export function buildEditableText(
  root: HTMLElement,
  body: TextBody | null,
  scale: number,
  fallback: Paragraph | null
): void {
  setStyle(root, body ? bodyCss(body, scale) : { position: 'absolute', inset: '0' })
  root.replaceChildren()
  const paragraphs = body && body.paragraphs.length ? body.paragraphs : fallback ? [fallback] : []
  paragraphs.forEach((p, pi) => {
    const block = document.createElement('div')
    block.dataset.p = String(pi)
    if (body) setStyle(block, paragraphCss(p, body, scale, pi === 0))
    if (p.bullet && body) {
      // The bullet is drawn but not editable; reading back skips it.
      const b = document.createElement('span')
      b.contentEditable = 'false'
      b.dataset.bullet = ''
      setStyle(b, bulletCss(p.bullet, p, body, scale))
      b.textContent = bulletText(p.bullet)
      block.append(b)
    }
    p.runs.forEach((r, ri) => {
      if (r.kind === 'br') {
        block.append(document.createElement('br'))
        return
      }
      const span = document.createElement('span')
      span.dataset.r = String(ri)
      setStyle(span, runCss(r.style, scale, body?.fontScale ?? 1))
      if (r.kind === 'field') {
        span.contentEditable = 'false'
        span.dataset.f = ''
      }
      span.textContent = r.text
      block.append(span)
    })
    // An empty line, or one ending in a break, needs a <br> to hold the caret.
    if (p.runs.length === 0 || p.runs[p.runs.length - 1].kind === 'br')
      block.append(document.createElement('br'))
    root.append(block)
  })
}

// ── Reading back ─────────────────────────────────────────────────────────────

const ALIGN: Record<string, Paragraph['align']> = {
  left: 'l',
  start: 'l',
  center: 'ctr',
  right: 'r',
  end: 'r',
  justify: 'just',
}

function parseColor(value: string): Rgba | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value)
  if (m)
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4]),
    }
  const h = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (h)
    return {
      r: parseInt(h[1].slice(0, 2), 16),
      g: parseInt(h[1].slice(2, 4), 16),
      b: parseInt(h[1].slice(4, 6), 16),
      a: 1,
    }
  return null
}

/** Whether an element or one of its ancestors (up to `stop`) draws `deco`. */
function decorated(el: Element | null, stop: Element, deco: 'underline' | 'line-through'): boolean {
  for (let e = el; e && e !== stop.parentElement; e = e.parentElement) {
    const line =
      (e as HTMLElement).style?.textDecorationLine || (e as HTMLElement).style?.textDecoration || ''
    if (line.includes(deco)) return true
    if (line === 'none' && e !== el) continue
    const tag = e.tagName
    if (deco === 'underline' && tag === 'U') return true
    if (deco === 'line-through' && (tag === 'S' || tag === 'STRIKE')) return true
    if (e === stop) break
  }
  return false
}

function nearestUnderline(el: Element | null, block: Element): boolean {
  // The innermost explicit decoration wins: a span saying "none" inside an
  // underlined one turns it off.
  for (let e = el; e && e !== block.parentElement; e = e.parentElement) {
    const h = e as HTMLElement
    const line = h.style?.textDecorationLine || ''
    if (line.includes('underline')) return true
    if (line === 'none') return false
    if (h.tagName === 'U') return true
    if (e === block) break
  }
  return decorated(el, block, 'underline')
}

type Measure = (el: Element) => {
  weight: number
  italic: boolean
  sizePx: number
  color: Rgba | null
}

const computed: Measure = (el) => {
  // A detached element has no computed style: report nothing changed.
  if (!el.isConnected) return { weight: NaN, italic: false, sizePx: 0, color: null }
  const cs = getComputedStyle(el)
  return {
    weight: Number(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400),
    italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
    sizePx: parseFloat(cs.fontSize) || 0,
    color: parseColor(cs.color),
  }
}

function formatDiff(
  el: Element,
  block: Element,
  ref: RunStyle,
  pxPerPt: number,
  measure: Measure
): RunFormat {
  const m = measure(el)
  const out: RunFormat = {}
  if (!Number.isFinite(m.weight)) return out
  const bold = m.weight >= 600
  if (bold !== ref.bold) out.bold = bold
  if (m.italic !== ref.italic) out.italic = m.italic
  const underline = nearestUnderline(el, block)
  if (underline !== (ref.underline && !ref.link)) out.underline = underline
  const refPx = ref.sizePt * pxPerPt * (ref.baseline !== 0 ? 0.67 : 1)
  if (m.sizePx > 0 && Math.abs(m.sizePx - refPx) > Math.max(0.5, pxPerPt * 0.3)) {
    out.size = Math.round((m.sizePx / pxPerPt) * 2) / 2
  }
  if (m.color && rgbaToHex(m.color) !== rgbaToHex(ref.color) && !ref.link)
    out.color = rgbaToHex(m.color)
  return out
}

const sameFormat = (a: RunFormat, b: RunFormat) =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.size === b.size &&
  a.color === b.color

const isEmptyFormat = (f: RunFormat) => Object.keys(f).length === 0

/** Run properties to start a new run from: the paragraph's end properties, retagged later. */
function endProps(p: Paragraph | undefined): XmlElement | null {
  return p?.el?.child('http://schemas.openxmlformats.org/drawingml/2006/main', 'endParaRPr') ?? null
}

/**
 * Read the edited DOM back into paragraphs. `body` is what was drawn;
 * `measure` is injectable for tests (jsdom has no layout).
 */
export function readEditableText(
  root: HTMLElement,
  body: TextBody | null,
  scale: number,
  measure: Measure = computed
): EditParagraph[] {
  const source = body?.paragraphs ?? []
  const fontScale = body?.fontScale ?? 1
  const pxPerPt = EMU_PER_PT * scale * fontScale
  const out: EditParagraph[] = []

  // Blocks: the root's children. Stray inline content at the root (a browser
  // that typed outside every block) is gathered into blocks of its own.
  const blocks: HTMLElement[] = []
  let stray: HTMLElement | null = null
  for (const node of [...root.childNodes]) {
    if (node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P')) {
      stray = null
      blocks.push(node)
    } else {
      if (!stray) {
        stray = document.createElement('div')
        blocks.push(stray)
      }
      stray.append(node.cloneNode(true))
    }
  }

  let lastIndex = 0
  for (const block of blocks) {
    const pi = block.dataset.p !== undefined ? Number(block.dataset.p) : lastIndex
    lastIndex = pi
    const para = source[pi]
    const runs: EditRun[] = []
    // The run the last piece of text came from: new text carries on in its
    // formatting, as typing does in PowerPoint (and over a selection, the
    // first run's).
    let lastRun: Run | null = para?.runs.find((r) => r.kind === 'text') ?? null
    const refFor = (el: Element): { run: Run | null; style: RunStyle | null } => {
      const span = el.closest('[data-r]')
      if (span && block.contains(span)) {
        const run = para?.runs[Number((span as HTMLElement).dataset.r)] ?? null
        if (run && run.kind === 'text') lastRun = run
        return { run, style: run?.style ?? para?.endStyle ?? null }
      }
      return { run: lastRun, style: lastRun?.style ?? para?.endStyle ?? null }
    }

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(/\u200b/g, '')
        if (!text) return
        const parent = node.parentElement ?? block
        const { run, style } = refFor(parent)
        const format = style ? formatDiff(parent, block, style, pxPerPt, measure) : {}
        const base =
          run && run.kind !== 'br' ? run.rPr : (runs[runs.length - 1]?.base ?? endProps(para))
        const prev = runs[runs.length - 1]
        if (
          prev &&
          !prev.br &&
          !prev.field &&
          prev.base === base &&
          sameFormat(prev.format, format)
        )
          prev.text += text
        else runs.push({ text, base, format })
        return
      }
      if (!(node instanceof HTMLElement)) return
      if (node.dataset.bullet !== undefined) return
      if (node.dataset.f !== undefined) {
        const run = para?.runs[Number(node.dataset.r)]
        if (run?.kind === 'field')
          runs.push({ text: run.text, base: run.rPr, format: {}, field: run.el })
        else if (node.textContent)
          runs.push({ text: node.textContent, base: endProps(para), format: {} })
        return
      }
      if (node.tagName === 'BR') {
        // The browser's caret-holder at the end of a block is not a line break.
        const isLast = !nextContent(node, block)
        if (isLast) return
        const { run } = refFor(node)
        runs.push({ text: '', base: run?.rPr ?? endProps(para), format: {}, br: true })
        return
      }
      for (const c of [...node.childNodes]) walk(c)
    }
    for (const c of [...block.childNodes]) walk(c)

    const alignName = block.style.textAlign
    const align = alignName ? ALIGN[alignName] : undefined
    const alignChanged = align !== undefined && para !== undefined && align !== para.align
    const paragraph: EditParagraph = {
      runs,
      source: para?.el ?? null,
      ...(alignChanged || (align && !para) ? { align } : {}),
    }
    if (para && !alignChanged && unchanged(runs, para)) paragraph.keep = true
    out.push(paragraph)
  }
  if (out.length === 0) out.push({ runs: [], source: source[0]?.el ?? null })
  return out
}

/** True when a following sibling chain (to the block's end) still has content. */
function nextContent(node: Node, block: HTMLElement): boolean {
  for (let n: Node | null = node; n && n !== block; n = n.parentNode) {
    for (let s = n.nextSibling; s; s = s.nextSibling) {
      if (s.nodeType === Node.TEXT_NODE && (s.textContent ?? '').replace(/\u200b/g, '') !== '')
        return true
      if (s instanceof HTMLElement && (s.tagName === 'BR' || (s.textContent ?? '') !== ''))
        return true
    }
  }
  return false
}

/** The read-back runs are the paragraph's own, with nothing reformatted. */
function unchanged(runs: EditRun[], para: Paragraph): boolean {
  const original = para.runs
  if (runs.length !== original.length) {
    // Adjacent original runs with the same properties read back merged; compare by text.
    const text = (rs: { text: string }[]) => rs.map((r) => r.text).join('')
    if (text(runs) !== text(original.map((r) => ({ text: r.kind === 'br' ? '' : r.text }))))
      return false
    return (
      runs.every((r) => isEmptyFormat(r.format)) &&
      runs.every((r) => !r.br) &&
      original.every((r) => r.kind !== 'br')
    )
  }
  return runs.every((r, i) => {
    const o = original[i]
    if (!isEmptyFormat(r.format)) return false
    if (o.kind === 'br') return !!r.br
    if (o.kind === 'field') return r.field === o.el
    return !r.br && !r.field && r.text === o.text && r.base === o.rPr
  })
}

/** For tests and the toolbar: the CSS colour of a run style. */
export function runColor(style: RunStyle): string {
  return css(style.color)
}
