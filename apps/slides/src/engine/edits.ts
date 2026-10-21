/**
 * Shape-level edits on a slide: insert, delete, move, restack, copy and
 * paste, and text/fill formatting. Each writes only the elements it changes,
 * in their schema position, and records the slide in the running transaction
 * (through `rootForEdit`).
 */
import type { Deck } from './deck.ts'
import { IMAGE_TYPES, NS, REL, SLIDE_BINDINGS } from './ns.ts'
import {
  childShapes,
  drawable,
  findShape,
  nextShapeId,
  ownXfrm,
  shapeId,
  shapeKind,
  spTree,
  writeGroupXfrm,
  writeXfrm,
  type Xfrm,
} from './shapes.ts'
import { pruneTimingForParagraphs, pruneTimingForShape } from './timing.ts'
import {
  applyRunFormat,
  textBody,
  writeParagraphs,
  type EditParagraph,
  type RunFormat,
} from './textEdit.ts'
import { createElement, escapeAttr, importInto, parseFragment, type XmlElement } from './xml.ts'

export type Box = { x: number; y: number; cx: number; cy: number }

const round = (n: number) => String(Math.round(n))

function treeForEdit(deck: Deck, part: string): XmlElement {
  const root = deck.pkg.rootForEdit(part)
  const tree = spTree(root)
  if (!tree) throw new Error(`${part} has no shape tree`)
  return tree
}

/** Append a shape to the top of the z-order (before the tree's extLst). */
function appendShape(tree: XmlElement, el: XmlElement): void {
  const ext = tree.child(NS.p, 'extLst')
  if (ext) tree.insertBefore(el, ext)
  else tree.append(el)
}

function insertFragment(deck: Deck, part: string, xml: string): XmlElement {
  const tree = treeForEdit(deck, part)
  const el = importInto(parseFragment(xml, SLIDE_BINDINGS), tree)
  appendShape(tree, el)
  return el
}

const xfrmXml = (b: Box) =>
  `<a:xfrm><a:off x="${round(b.x)}" y="${round(b.y)}"/><a:ext cx="${round(Math.max(0, b.cx))}" cy="${round(Math.max(0, b.cy))}"/></a:xfrm>`

/** A new, empty text box. Returns its id. */
export function insertTextBox(deck: Deck, part: string, box: Box): string {
  const id = nextShapeId(treeForEdit(deck, part))
  insertFragment(
    deck,
    part,
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id - 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrmXml(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`
  )
  return String(id)
}

const SHAPE_NAMES: Record<string, string> = {
  rect: 'Rectangle',
  roundRect: 'Rectangle: Rounded Corners',
  ellipse: 'Oval',
  triangle: 'Isosceles Triangle',
  rightArrow: 'Arrow: Right',
  star5: 'Star: 5 Points',
  line: 'Straight Connector',
}

/**
 * A new preset shape styled from the theme the way PowerPoint styles a new
 * one (accent 1 fill, a darker outline, light text). Lines are connectors.
 */
export function insertShape(deck: Deck, part: string, preset: string, box: Box): string {
  const id = nextShapeId(treeForEdit(deck, part))
  const name = `${SHAPE_NAMES[preset] ?? 'Shape'} ${id - 1}`
  if (preset === 'line') {
    insertFragment(
      deck,
      part,
      `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${escapeAttr(name, '"')}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
        `<p:spPr>${xfrmXml(box)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr>` +
        `<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>` +
        `<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style></p:cxnSp>`
    )
    return String(id)
  }
  insertFragment(
    deck,
    part,
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeAttr(name, '"')}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrmXml(box)}<a:prstGeom prst="${escapeAttr(preset, '"')}"><a:avLst/></a:prstGeom></p:spPr>` +
      `<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>` +
      `<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>` +
      `<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>` +
      `<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`
  )
  return String(id)
}

/** Add an image part to the package (or reuse an identical one) and relate it to `part`. */
function addImage(deck: Deck, part: string, bytes: Uint8Array, ext: string): string {
  const e = ext.toLowerCase()
  const type = IMAGE_TYPES[e]
  if (!type) throw new Error(`.${ext} pictures cannot be inserted`)
  const media = deck.pkg.freeName(`ppt/media/image{n}.${e === 'jpeg' ? 'jpeg' : e}`)
  deck.pkg.write(media, bytes)
  deck.pkg.ensureDefault(e === 'jpeg' ? 'jpeg' : e, type)
  return deck.pkg.addRelationship(part, REL.image, media)
}

/** A picture from image bytes, placed in `box`. Returns its id. */
export function insertPicture(
  deck: Deck,
  part: string,
  bytes: Uint8Array,
  ext: string,
  box: Box,
  name: string
): string {
  const rId = addImage(deck, part, bytes, ext)
  const id = nextShapeId(treeForEdit(deck, part))
  insertFragment(
    deck,
    part,
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id - 1}" descr="${escapeAttr(name, '"')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr>${xfrmXml(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  )
  return String(id)
}

/** Delete shapes (and the animations on them). */
export function deleteShapes(deck: Deck, part: string, ids: string[]): void {
  const tree = treeForEdit(deck, part)
  const root = deck.pkg.rootForEdit(part)
  for (const id of ids) {
    const el = findShape(tree, id)
    if (!el) continue
    // A group takes its members' animations with it.
    const all = [id, ...descendantIds(el)]
    el.remove()
    for (const sid of all) pruneTimingForShape(root, sid)
  }
}

function descendantIds(el: XmlElement): string[] {
  const d = drawable(el)
  if (!d || shapeKind(d) !== 'grpSp') return []
  const out: string[] = []
  for (const c of childShapes(d)) {
    const id = shapeId(c)
    if (id) out.push(id)
    out.push(...descendantIds(c))
  }
  return out
}

/** Give shape `id` a new frame. Groups keep their child space, so members follow. */
export function setShapeBox(deck: Deck, part: string, id: string, next: Xfrm): void {
  const tree = treeForEdit(deck, part)
  const el = findShape(tree, id)
  if (!el) return
  const d = drawable(el)
  if (d && shapeKind(d) === 'grpSp') writeGroupXfrm(d, next)
  else writeXfrm(el, next)
}

export type Restack = 'front' | 'back' | 'forward' | 'backward'

/** Change the z-order of top-level shapes. */
export function restackShapes(deck: Deck, part: string, ids: string[], how: Restack): void {
  const tree = treeForEdit(deck, part)
  const shapes = childShapes(tree)
  const chosen = shapes.filter((s) => ids.includes(shapeId(s) ?? ''))
  if (chosen.length === 0) return
  const others = shapes.filter((s) => !chosen.includes(s))
  let order: XmlElement[]
  if (how === 'front') order = [...others, ...chosen]
  else if (how === 'back') order = [...chosen, ...others]
  else {
    order = [...shapes]
    const step = how === 'forward' ? 1 : -1
    const indices = chosen.map((c) => order.indexOf(c)).sort((a, b) => (step > 0 ? b - a : a - b))
    for (const i of indices) {
      const j = i + step
      if (j < 0 || j >= order.length || chosen.includes(order[j])) continue
      ;[order[i], order[j]] = [order[j], order[i]]
    }
  }
  if (order.every((s, i) => s === shapes[i])) return
  // Re-insert in the new order after the tree's own properties, before its extLst.
  const ext = tree.child(NS.p, 'extLst')
  for (const s of order) {
    if (ext) tree.insertBefore(s, ext)
    else tree.append(s)
  }
}

// ── Text and fills ───────────────────────────────────────────────────────────

/** Replace a shape's paragraphs; animations on paragraphs that no longer exist go. */
export function writeShapeText(
  deck: Deck,
  part: string,
  id: string,
  paragraphs: EditParagraph[]
): void {
  const tree = treeForEdit(deck, part)
  const el = findShape(tree, id)
  if (!el) return
  const body = textBody(el, true)
  if (!body) return
  writeParagraphs(body, paragraphs)
  pruneTimingForParagraphs(deck.pkg.rootForEdit(part), id, Math.max(1, paragraphs.length))
}

/** Apply run formatting to every run of the shapes' text. */
export function formatShapesText(deck: Deck, part: string, ids: string[], format: RunFormat): void {
  const tree = treeForEdit(deck, part)
  for (const id of ids) {
    const el = findShape(tree, id)
    const body = el ? textBody(el) : null
    if (!body) continue
    for (const p of body.childrenOf(NS.a, 'p')) {
      for (const r of p.elements()) {
        if (!(r.is(NS.a, 'r') || r.is(NS.a, 'fld') || r.is(NS.a, 'br'))) continue
        let rPr = r.child(NS.a, 'rPr')
        if (!rPr) {
          rPr = createElement(r, NS.a, 'rPr', 'a', { lang: 'en-US' })
          r.insert(rPr, 0)
        }
        applyRunFormat(rPr, format)
      }
      let end = p.child(NS.a, 'endParaRPr')
      if (!end) {
        end = createElement(p, NS.a, 'endParaRPr', 'a', { lang: 'en-US' })
        p.append(end)
      }
      applyRunFormat(end, format)
    }
  }
}

/** Set the alignment of every paragraph of the shapes. */
export function alignShapesText(deck: Deck, part: string, ids: string[], align: string): void {
  const tree = treeForEdit(deck, part)
  for (const id of ids) {
    const el = findShape(tree, id)
    const body = el ? textBody(el) : null
    if (!body) continue
    for (const p of body.childrenOf(NS.a, 'p')) {
      let pPr = p.child(NS.a, 'pPr')
      if (!pPr) {
        pPr = createElement(p, NS.a, 'pPr', 'a')
        p.insert(pPr, 0)
      }
      pPr.setAttr('algn', align)
    }
  }
}

const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']

function fillElement(scope: XmlElement, hex: string | null): XmlElement {
  if (hex === null) return createElement(scope, NS.a, 'noFill', 'a')
  const fill = createElement(scope, NS.a, 'solidFill', 'a')
  fill.append(createElement(fill, NS.a, 'srgbClr', 'a', { val: hex.toUpperCase() }))
  return fill
}

function spPrForEdit(el: XmlElement): XmlElement | null {
  const d = drawable(el)
  if (!d || !['sp', 'cxnSp', 'pic'].includes(shapeKind(d) ?? '')) return null
  let spPr = d.child(d.ns as string, 'spPr')
  if (!spPr) {
    spPr = createElement(d, d.ns as string, 'spPr', 'p')
    const nv = d.elements()[0]
    if (nv) d.insertAfter(spPr, nv)
    else d.insert(spPr, 0)
  }
  return spPr
}

/** Fill shapes with a colour (`RRGGBB`), or with nothing (null). */
export function fillShapes(deck: Deck, part: string, ids: string[], hex: string | null): void {
  const tree = treeForEdit(deck, part)
  for (const id of ids) {
    const el = findShape(tree, id)
    const spPr = el ? spPrForEdit(el) : null
    if (!spPr) continue
    for (const tag of FILL_TAGS) for (const f of spPr.childrenOf(NS.a, tag)) f.remove()
    // spPr: xfrm, geometry, fill, ln, …
    const after =
      spPr.child(NS.a, 'prstGeom') ?? spPr.child(NS.a, 'custGeom') ?? spPr.child(NS.a, 'xfrm')
    const fill = fillElement(spPr, hex)
    if (after) spPr.insertAfter(fill, after)
    else spPr.insert(fill, 0)
  }
}

/** Outline shapes with a colour, or no outline (null). */
export function outlineShapes(deck: Deck, part: string, ids: string[], hex: string | null): void {
  const tree = treeForEdit(deck, part)
  for (const id of ids) {
    const el = findShape(tree, id)
    const spPr = el ? spPrForEdit(el) : null
    if (!spPr) continue
    let ln = spPr.child(NS.a, 'ln')
    if (!ln) {
      ln = createElement(spPr, NS.a, 'ln', 'a')
      const after =
        FILL_TAGS.map((t) => spPr.child(NS.a, t)).find((x) => x) ??
        spPr.child(NS.a, 'prstGeom') ??
        spPr.child(NS.a, 'custGeom') ??
        spPr.child(NS.a, 'xfrm')
      if (after) spPr.insertAfter(ln, after)
      else spPr.insert(ln, 0)
    }
    for (const tag of FILL_TAGS) for (const f of ln.childrenOf(NS.a, tag)) f.remove()
    ln.insert(fillElement(ln, hex), 0)
  }
}

// ── Copy and paste ───────────────────────────────────────────────────────────

export type ClipRelation = {
  /** The r:* id the XML uses. */
  id: string
  type: string
  external: string | null
  /** For an internal target: its bytes and extension (copied into the target deck when needed). */
  bytes: Uint8Array | null
  ext: string
  contentType: string | null
  /** The target has relationships of its own (a chart, a diagram): it cannot travel as bytes. */
  hasRels: boolean
  /** The source part name, reused when pasting into the same deck. */
  part: string | null
}

export type Clip = {
  shapes: { xml: string; bindings: Record<string, string> }[]
  rels: ClipRelation[]
  /** Identifies the deck copied from: paste in the same deck reuses its parts. */
  deckKey: object
}

const R_ATTRS = ['embed', 'link', 'id', 'pict']

function relIdsIn(el: XmlElement, out = new Set<string>()): Set<string> {
  for (const a of el.attrs) {
    const colon = a.name.indexOf(':')
    if (colon < 0 || a.name.startsWith('xmlns')) continue
    if (
      R_ATTRS.includes(a.name.slice(colon + 1)) &&
      el.lookupNamespace(a.name.slice(0, colon)) === NS.r
    ) {
      out.add(el.attrNS(NS.r, a.name.slice(colon + 1)) as string)
    }
  }
  for (const c of el.children) if (c.kind === 'element') relIdsIn(c, out)
  return out
}

function scopeBindings(el: XmlElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (let e: XmlElement | null = el; e; e = e.parent) {
    for (const a of e.attrs) {
      if (!a.name.startsWith('xmlns:')) continue
      const p = a.name.slice(6)
      if (!(p in out)) out[p] = e.attr(a.name) as string
    }
  }
  return out
}

/** Copy shapes, with what their relationships point at, for a later paste. */
export function copyShapes(deck: Deck, part: string, ids: string[]): Clip | null {
  const root = deck.pkg.root(part)
  const tree = root ? spTree(root) : null
  if (!tree) return null
  const shapes: Clip['shapes'] = []
  const rels: ClipRelation[] = []
  const relsOf = deck.pkg.relationships(part)
  for (const s of childShapes(tree)) {
    if (!ids.includes(shapeId(s) ?? '')) continue
    shapes.push({ xml: s.serialize(), bindings: scopeBindings(s) })
    for (const rid of relIdsIn(s)) {
      if (rels.some((r) => r.id === rid)) continue
      const rel = relsOf.find((r) => r.id === rid)
      if (!rel) continue
      const target = rel.external ? null : deck.pkg.target(part, rid)
      const bytes = target ? deck.pkg.bytes(target) : null
      rels.push({
        id: rid,
        type: rel.type,
        external: rel.external ? rel.target : null,
        bytes,
        ext: target ? target.slice(target.lastIndexOf('.') + 1) : '',
        contentType: target ? deck.pkg.contentType(target) : null,
        hasRels: target ? deck.pkg.relationships(target).length > 0 : false,
        part: target,
      })
    }
  }
  return shapes.length ? { shapes, rels, deckKey: deck } : null
}

/**
 * Paste a clip onto a slide, offset by `offset` EMU. Shapes get fresh ids,
 * relationships are recreated (pictures and media copied when the clip came
 * from another deck), connections to shapes not pasted are dropped. A
 * reference that cannot be carried over (a jump to a slide of another deck,
 * a chart) would point at nothing and make PowerPoint repair the file: a
 * hyperlink loses it, any other shape holding one is left out. Returns the
 * new ids.
 */
export function pasteShapes(deck: Deck, part: string, clip: Clip, offset: number): string[] {
  const tree = treeForEdit(deck, part)
  const relMap = new Map<string, string>()
  for (const rel of clip.rels) {
    if (rel.external !== null) {
      relMap.set(rel.id, deck.pkg.addRelationship(part, rel.type, rel.external, true))
      continue
    }
    let target = clip.deckKey === deck && rel.part && deck.pkg.has(rel.part) ? rel.part : null
    // Leaf parts (pictures, video, audio, embedded files) travel as bytes; slides never do.
    if (!target && rel.bytes && !rel.hasRels && rel.type !== REL.slide) {
      const ext = rel.ext.toLowerCase()
      const dir = rel.part ? rel.part.slice(0, rel.part.lastIndexOf('/') + 1) : 'ppt/media/'
      const base = (rel.part ?? 'image').slice(dir.length).replace(/\d*\.[^.]+$/, '') || 'image'
      target = deck.pkg.freeName(`${dir}${base}{n}.${ext}`)
      deck.pkg.write(target, rel.bytes.slice())
      const type = rel.contentType ?? IMAGE_TYPES[ext]
      if (type) {
        if (IMAGE_TYPES[ext] === type || /^(image|video|audio)\//.test(type))
          deck.pkg.ensureDefault(ext, type)
        else deck.pkg.setOverride(target, type)
      }
    }
    if (target) relMap.set(rel.id, deck.pkg.addRelationship(part, rel.type, target))
  }
  let next = nextShapeId(tree)
  const idMap = new Map<string, string>()
  const added: XmlElement[] = []
  for (const s of clip.shapes) {
    const el = importInto(parseFragment(s.xml, s.bindings), tree)
    const fresh = new Map<string, string>()
    let unmapped = false
    const stack = [el]
    while (stack.length) {
      const e = stack.pop() as XmlElement
      if (e.local === 'cNvPr') {
        const id = String(next++)
        fresh.set(e.attr('id') ?? '', id)
        e.setAttr('id', id)
      }
      let drop = false
      for (const a of [...e.attrs]) {
        const colon = a.name.indexOf(':')
        if (colon < 0 || a.name.startsWith('xmlns')) continue
        if (!R_ATTRS.includes(a.name.slice(colon + 1))) continue
        if (e.lookupNamespace(a.name.slice(0, colon)) !== NS.r) continue
        const old = e.attr(a.name) as string
        const mapped = relMap.get(old)
        if (mapped) e.setAttr(a.name, mapped)
        else if (old !== '' && ['hlinkClick', 'hlinkHover', 'hlinkMouseOver'].includes(e.local))
          drop = true
        else if (old !== '') unmapped = true
      }
      if (drop) {
        e.remove()
        continue
      }
      for (const c of e.children) if (c.kind === 'element') stack.push(c)
    }
    if (unmapped) continue
    for (const [k, v] of fresh) idMap.set(k, v)
    added.push(el)
  }
  for (const el of added) {
    for (const tag of ['stCxn', 'endCxn']) {
      for (const c of el.descendants(NS.a, tag)) {
        const mapped = idMap.get(c.attr('id') ?? '')
        if (mapped) c.setAttr('id', mapped)
        else c.remove()
      }
    }
    const x = ownXfrm(el)
    if (x && offset) {
      const d = drawable(el)
      if (d && shapeKind(d) === 'grpSp')
        writeGroupXfrm(d, { ...x, x: x.x + offset, y: x.y + offset })
      else writeXfrm(el, { ...x, x: x.x + offset, y: x.y + offset })
    }
    appendShape(tree, el)
  }
  // Relationships made for shapes that were left out serve nothing: drop them.
  const kept = new Set<string>()
  for (const el of added) for (const id of relIdsIn(el)) kept.add(id)
  for (const id of relMap.values()) if (!kept.has(id)) deck.pkg.removeRelationship(part, id)
  return added.map((el) => shapeId(el) as string)
}

/** How many paragraphs a shape's text has now (0 for a shape without text). */
export function paragraphCount(deck: Deck, part: string, id: string): number {
  const root = deck.pkg.root(part)
  const tree = root ? spTree(root) : null
  const el = tree ? findShape(tree, id) : null
  const body = el ? textBody(el) : null
  return body ? body.childrenOf(NS.a, 'p').length : 0
}
