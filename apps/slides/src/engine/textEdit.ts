/**
 * Writing text into a shape's `p:txBody`. The editor hands over paragraphs of
 * runs; a paragraph that comes back unchanged keeps its original element
 * (fields, extension lists and all), a changed one is rebuilt from the
 * original's paragraph properties and the runs' properties.
 */
import { NS } from './ns.ts'
import { drawable } from './shapes.ts'
import { createElement, type XmlElement } from './xml.ts'

export type RunFormat = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** Points. */
  size?: number
  /** `RRGGBB`. */
  color?: string
}

export type EditRun = {
  text: string
  /** The run's original `a:rPr` (cloned), whose other attributes are kept. */
  base: XmlElement | null
  /** Explicit changes on top of `base`. */
  format: RunFormat
  /** A line break (`a:br`) rather than text. */
  br?: boolean
  /** An original field (`a:fld`, a slide number or date), kept as it was. */
  field?: XmlElement
}

export type EditParagraph = {
  runs: EditRun[]
  /** The original paragraph this one came from, if any: its `a:pPr` and `a:endParaRPr` are kept. */
  source: XmlElement | null
  /** `l` | `ctr` | `r` | `just`, or undefined to keep the source's. */
  align?: string
  /** The paragraph did not change: keep `source` exactly as it is. */
  keep?: boolean
}

/** `p:txBody` of a shape (creating one on a shape that has none). */
export function textBody(el: XmlElement, create = false): XmlElement | null {
  const d = drawable(el)
  if (!d) return null
  let body = d.child(d.ns as string, 'txBody')
  if (!body && create && d.local === 'sp') {
    body = createElement(d, d.ns as string, 'txBody', 'p')
    body.append(createElement(body, NS.a, 'bodyPr', 'a'))
    body.append(createElement(body, NS.a, 'lstStyle', 'a'))
    // txBody comes after spPr and p:style in p:sp.
    d.append(body)
  }
  return body
}

/** Apply `format` to an `a:rPr` (or `a:endParaRPr`), writing only what it names. */
export function applyRunFormat(rPr: XmlElement, format: RunFormat): void {
  if (format.bold !== undefined) rPr.setAttr('b', format.bold ? '1' : '0')
  if (format.italic !== undefined) rPr.setAttr('i', format.italic ? '1' : '0')
  if (format.underline !== undefined) rPr.setAttr('u', format.underline ? 'sng' : 'none')
  if (format.size !== undefined) rPr.setAttr('sz', String(Math.round(format.size * 100)))
  if (format.color !== undefined) {
    // rPr children: ln, fill, effects, highlight, … latin, ea, cs, sym, hlinkClick…
    for (const tag of ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']) {
      for (const f of rPr.childrenOf(NS.a, tag)) f.remove()
    }
    const fill = createElement(rPr, NS.a, 'solidFill', 'a')
    fill.append(createElement(fill, NS.a, 'srgbClr', 'a', { val: format.color.toUpperCase() }))
    const ln = rPr.child(NS.a, 'ln')
    if (ln) rPr.insertAfter(fill, ln)
    else rPr.insert(fill, 0)
  }
}

/** A copy of a run-properties element (rPr, endParaRPr or defRPr) as an `a:rPr`. */
function runProps(scope: XmlElement, base: XmlElement | null): XmlElement {
  if (!base) return createElement(scope, NS.a, 'rPr', 'a', { lang: 'en-US' })
  const copy = base.clone()
  if (copy.local !== 'rPr') retag(copy, 'rPr')
  return copy
}

function buildRun(scope: XmlElement, run: EditRun): XmlElement {
  if (run.field) {
    const fld = run.field.clone()
    const rPr = fld.child(NS.a, 'rPr')
    if (rPr && Object.keys(run.format).length > 0) applyRunFormat(rPr, run.format)
    return fld
  }
  if (run.br) {
    const br = createElement(scope, NS.a, 'br', 'a')
    const rPr = runProps(br, run.base)
    applyRunFormat(rPr, run.format)
    br.append(rPr)
    return br
  }
  const r = createElement(scope, NS.a, 'r', 'a')
  const rPr = runProps(r, run.base)
  rPr.removeAttr('dirty')
  applyRunFormat(rPr, run.format)
  r.append(rPr)
  const t = createElement(r, NS.a, 't', 'a')
  t.setText(run.text)
  r.append(t)
  return r
}

/** Replace a text body's paragraphs. */
export function writeParagraphs(body: XmlElement, paragraphs: EditParagraph[]): void {
  const keep = body.elements().filter((e) => !e.is(NS.a, 'p'))
  const out: XmlElement[] = []
  for (const para of paragraphs.length ? paragraphs : [{ runs: [], source: null }]) {
    if (para.keep && para.source) {
      // Unchanged: the original element goes back as it was (a clone, since
      // the same source may be kept twice when a paragraph was split).
      out.push(out.includes(para.source) ? para.source.clone() : para.source)
      continue
    }
    const p = createElement(body, NS.a, 'p', 'a')
    const pPr = para.source?.child(NS.a, 'pPr')?.clone() ?? null
    if (para.align !== undefined) {
      const target = pPr ?? createElement(p, NS.a, 'pPr', 'a')
      if (para.align === 'l') target.removeAttr('algn')
      else target.setAttr('algn', para.align)
      p.append(target)
    } else if (pPr) {
      p.append(pPr)
    }
    for (const run of para.runs)
      if (run.br || run.field || run.text !== '') p.append(buildRun(p, run))
    const end = para.source?.child(NS.a, 'endParaRPr')?.clone()
    const firstBase = para.runs.find((r) => r.base)?.base
    const endRPr = end ?? (firstBase ? retag(firstBase.clone(), 'endParaRPr') : null)
    if (endRPr) {
      endRPr.removeAttr('dirty')
      if (para.runs[0]) applyRunFormat(endRPr, para.runs[para.runs.length - 1].format)
      p.append(endRPr)
    } else {
      p.append(createElement(p, NS.a, 'endParaRPr', 'a', { lang: 'en-US' }))
    }
    out.push(p)
  }
  body.replaceChildren([...keep, ...out])
}

/** Rename a cloned run-properties element (`a:rPr` → `a:endParaRPr`). */
function retag(el: XmlElement, local: string): XmlElement {
  const prefix = el.prefix
  el.rename(prefix ? `${prefix}:${local}` : local)
  return el
}

/**
 * Set a shape's text to `text` (lines become paragraphs), keeping the first
 * run's properties and the paragraphs' properties. The quick path the spike
 * and the title box use.
 */
export function setPlainText(el: XmlElement, text: string): void {
  const body = textBody(el, true)
  if (!body) throw new Error('this shape holds no text')
  const paras = body.childrenOf(NS.a, 'p')
  const firstRun = paras.flatMap((p) => p.childrenOf(NS.a, 'r'))[0]
  const base = firstRun?.child(NS.a, 'rPr') ?? null
  writeParagraphs(
    body,
    text.split('\n').map((line, i) => ({
      source: paras[i] ?? paras[paras.length - 1] ?? null,
      runs: [{ text: line, base, format: {} }],
    }))
  )
}
