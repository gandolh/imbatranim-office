/**
 * A presentation over its package: the slide list, layouts, masters and
 * notes, and the slide-level operations (add from a layout, duplicate,
 * delete, reorder, notes). Each operation patches only the parts it must:
 * `presentation.xml` and its rels for the slide list, the content types for
 * new and removed parts, the slide parts themselves. Everything else is
 * copied through on save.
 *
 * Operations do not open transactions themselves; the editor wraps each user
 * action in one (see editor/history.ts), so an action that does several
 * operations undoes in one step.
 */
import { NOTES_MASTER_XML, themeXml } from './blank.ts'
import { CONTENT_TYPE, NS, REL } from './ns.ts'
import { Package, relativeTarget, relsPartOf, resolveTarget } from './opc.ts'
import {
  childShapes,
  matchLayoutPlaceholder,
  matchMasterPlaceholder,
  ownXfrm,
  placeholderOf,
  spTree,
  type Xfrm,
} from './shapes.ts'
import { createElement, escapeAttr, type XmlElement } from './xml.ts'
import type { ZipLimits } from './zip.ts'

export type SlideRef = {
  /** `p:sldId/@id`, unique in the deck and stable across reorders. */
  id: number
  rId: string
  part: string
}

export type LayoutRef = {
  part: string
  master: string
  name: string
  /** `p:sldLayout/@type` (title, obj, twoObj, blank, …), or 'cust'. */
  type: string
}

export class NotAPresentationError extends Error {
  constructor(message = 'This file is not a PowerPoint presentation.') {
    super(message)
    this.name = 'NotAPresentationError'
  }
}

/** Placeholders a new slide does not get from its layout (PowerPoint's own rule). */
const FOOTER_TYPES = new Set(['dt', 'ftr', 'sldNum'])

/** Relationship types whose targets a duplicated slide gets its own copy of. */
const OWNED = new Set<string>([
  REL.notesSlide,
  REL.chart,
  REL.comments,
  REL.tags,
  REL.diagramData,
  REL.diagramLayout,
  REL.diagramQuickStyle,
  REL.diagramColors,
  REL.diagramDrawing,
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package',
  'http://schemas.microsoft.com/office/2011/relationships/chartStyle',
  'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle',
])

const numberedPattern = (part: string) => {
  const m = /^(.*?)(\d*)(\.[^./]+)$/.exec(part)
  return m ? `${m[1]}{n}${m[3]}` : `${part}{n}`
}

export class Deck {
  readonly pkg: Package
  readonly presPart: string

  private constructor(pkg: Package, presPart: string) {
    this.pkg = pkg
    this.presPart = presPart
  }

  static open(bytes: Uint8Array, limits?: ZipLimits): Deck {
    const pkg = Package.open(bytes, limits)
    const presPart = pkg.targetOfType('', REL.officeDocument)
    const root = presPart ? pkg.root(presPart) : null
    if (!presPart || !root || !root.is(NS.p, 'presentation')) throw new NotAPresentationError()
    return new Deck(pkg, presPart)
  }

  private get pres(): XmlElement {
    return this.pkg.root(this.presPart) as XmlElement
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** The slides, in show order. Slides whose part is missing are skipped. */
  slides(): SlideRef[] {
    const list = this.pres.child(NS.p, 'sldIdLst')
    if (!list) return []
    const out: SlideRef[] = []
    for (const el of list.childrenOf(NS.p, 'sldId')) {
      const rId = el.attrNS(NS.r, 'id') ?? ''
      const part = this.pkg.target(this.presPart, rId)
      if (!part || !this.pkg.has(part)) continue
      out.push({ id: Number(el.attr('id')), rId, part })
    }
    return out
  }

  /** Slide size in EMU (PowerPoint's default 4:3 when the deck omits it). */
  size(): { cx: number; cy: number } {
    const sz = this.pres.child(NS.p, 'sldSz')
    const cx = Number(sz?.attr('cx'))
    const cy = Number(sz?.attr('cy'))
    return {
      cx: Number.isFinite(cx) && cx > 0 ? cx : 9144000,
      cy: Number.isFinite(cy) && cy > 0 ? cy : 6858000,
    }
  }

  /** The masters, in order. */
  masters(): string[] {
    const list = this.pres.child(NS.p, 'sldMasterIdLst')
    if (!list) return []
    return list
      .childrenOf(NS.p, 'sldMasterId')
      .map((el) => this.pkg.target(this.presPart, el.attrNS(NS.r, 'id') ?? ''))
      .filter((p): p is string => p !== null && this.pkg.has(p))
  }

  /** Every layout, master by master, in each master's order. */
  layouts(): LayoutRef[] {
    const out: LayoutRef[] = []
    for (const master of this.masters()) {
      const root = this.pkg.root(master)
      const ids = root?.child(NS.p, 'sldLayoutIdLst')?.childrenOf(NS.p, 'sldLayoutId') ?? []
      for (const el of ids) {
        const part = this.pkg.target(master, el.attrNS(NS.r, 'id') ?? '')
        if (!part || !this.pkg.has(part)) continue
        const layout = this.pkg.root(part)
        out.push({
          part,
          master,
          name: layout?.child(NS.p, 'cSld')?.attr('name') ?? 'Layout',
          type: layout?.attr('type') ?? 'cust',
        })
      }
    }
    return out
  }

  layoutOf(slidePart: string): string | null {
    return this.pkg.targetOfType(slidePart, REL.slideLayout)
  }

  masterOf(layoutPart: string): string | null {
    return this.pkg.targetOfType(layoutPart, REL.slideMaster)
  }

  themeOf(masterPart: string): string | null {
    return this.pkg.targetOfType(masterPart, REL.theme)
  }

  notesOf(slidePart: string): string | null {
    const part = this.pkg.targetOfType(slidePart, REL.notesSlide)
    return part && this.pkg.has(part) ? part : null
  }

  notesMaster(): string | null {
    const el = this.pres.path([NS.p, 'notesMasterIdLst'], [NS.p, 'notesMasterId'])
    // Some writers (python-pptx) relate the notes master without listing it.
    const part = el
      ? this.pkg.target(this.presPart, el.attrNS(NS.r, 'id') ?? '')
      : this.pkg.targetOfType(this.presPart, REL.notesMaster)
    return part && this.pkg.has(part) ? part : null
  }

  /**
   * Where a shape sits, following placeholder inheritance: its own transform,
   * else its layout placeholder's, else its master placeholder's.
   */
  resolvedXfrm(part: string, el: XmlElement): Xfrm | null {
    const own = ownXfrm(el)
    if (own) return own
    const ph = placeholderOf(el)
    if (!ph) return null
    const root = this.pkg.root(part)
    if (!root) return null
    if (root.is(NS.p, 'sld')) {
      const layout = this.layoutOf(part)
      const layoutTree = layout ? spTree(this.pkg.root(layout) as XmlElement) : null
      const match = layoutTree ? matchLayoutPlaceholder(layoutTree, ph) : null
      if (match && layout) return this.resolvedXfrm(layout, match)
      const master = layout ? this.masterOf(layout) : null
      const masterTree = master ? spTree(this.pkg.root(master) as XmlElement) : null
      const m = masterTree ? matchMasterPlaceholder(masterTree, ph.type) : null
      return m ? ownXfrm(m) : null
    }
    if (root.is(NS.p, 'sldLayout')) {
      const master = this.masterOf(part)
      const masterTree = master ? spTree(this.pkg.root(master) as XmlElement) : null
      const m = masterTree ? matchMasterPlaceholder(masterTree, ph.type) : null
      return m ? ownXfrm(m) : null
    }
    return null
  }

  // ── Slide list operations ──────────────────────────────────────────────────

  private sldIdLstForEdit(): XmlElement {
    const pres = this.pkg.rootForEdit(this.presPart)
    let list = pres.child(NS.p, 'sldIdLst')
    if (!list) {
      // Schema order: sldMasterIdLst, notesMasterIdLst, handoutMasterIdLst, sldIdLst, sldSz…
      list = createElement(pres, NS.p, 'sldIdLst', 'p')
      const after =
        pres.child(NS.p, 'handoutMasterIdLst') ??
        pres.child(NS.p, 'notesMasterIdLst') ??
        pres.child(NS.p, 'sldMasterIdLst')
      if (after) pres.insertAfter(list, after)
      else pres.insert(list, 0)
    }
    return list
  }

  private nextSlideId(): number {
    let max = 255
    for (const s of this.slides()) if (s.id > max) max = s.id
    // Ids of slides whose parts went missing still count.
    for (const el of this.pres.child(NS.p, 'sldIdLst')?.childrenOf(NS.p, 'sldId') ?? []) {
      const id = Number(el.attr('id'))
      if (Number.isFinite(id) && id > max) max = id
    }
    return max + 1
  }

  /** Put a slide part into the show at `index` (presentation rels, sldIdLst, sections). */
  private register(part: string, index: number): SlideRef {
    const rId = this.pkg.addRelationship(this.presPart, REL.slide, part)
    const id = this.nextSlideId()
    const list = this.sldIdLstForEdit()
    const before = this.slides()
    const el = createElement(list, NS.p, 'sldId', 'p', { id: String(id) })
    const rPrefix = list.lookupPrefix(NS.r) ?? 'r'
    if (list.lookupPrefix(NS.r) === null) el.setAttr('xmlns:r', NS.r)
    el.attrs.push({ name: `${rPrefix}:id`, raw: escapeAttr(rId, '"'), quote: '"' })
    const ids = list.childrenOf(NS.p, 'sldId')
    const visible = before.map((s) => ids.find((e) => Number(e.attr('id')) === s.id))
    const anchor = index < visible.length ? visible[index] : null
    if (anchor) list.insertBefore(el, anchor)
    else list.append(el)
    const prev = index > 0 ? before[Math.min(index, before.length) - 1] : null
    this.sections().placeNew(id, prev?.id ?? null)
    return { id, rId, part }
  }

  /** A new slide from `layoutPart`, with the layout's placeholders, inserted at `index`. */
  addSlide(layoutPart: string, index: number): SlideRef {
    const layout = this.pkg.root(layoutPart)
    if (!layout) throw new Error(`no layout ${layoutPart}`)
    const part = this.pkg.freeName('ppt/slides/slide{n}.xml')
    const shapes: string[] = []
    let nextId = 2
    const layoutTree = spTree(layout)
    for (const sp of layoutTree ? childShapes(layoutTree) : []) {
      if (!sp.is(NS.p, 'sp')) continue
      const ph = placeholderOf(sp)
      if (!ph || FOOTER_TYPES.has(ph.type)) continue
      const phEl = sp.path([NS.p, 'nvSpPr'], [NS.p, 'nvPr'], [NS.p, 'ph']) as XmlElement
      const keep = ['type', 'orient', 'sz', 'idx']
        .map((a) => [a, phEl.attr(a)] as const)
        .filter(([, v]) => v !== null)
        .map(([a, v]) => ` ${a}="${escapeAttr(v as string, '"')}"`)
        .join('')
      const name = sp.path([NS.p, 'nvSpPr'], [NS.p, 'cNvPr'])?.attr('name') ?? 'Placeholder'
      shapes.push(
        `<p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="${escapeAttr(name, '"')}"/>` +
          `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${keep}/></p:nvPr></p:nvSpPr>` +
          `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`
      )
    }
    this.pkg.writeXml(
      part,
      `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">` +
        `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
        `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
        `${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    )
    this.pkg.addRelationship(part, REL.slideLayout, layoutPart)
    this.pkg.setOverride(part, CONTENT_TYPE.slide)
    return this.register(part, index)
  }

  /** Copy a part (and the parts it owns, recursively) to a new name; returns the copy's name. */
  private copyPart(part: string, renames: Map<string, string>): string {
    const existing = renames.get(part)
    if (existing) return existing
    const copy = this.pkg.freeName(numberedPattern(part))
    renames.set(part, copy)
    const bytes = this.pkg.bytes(part)
    if (bytes) this.pkg.write(copy, bytes.slice())
    const type = this.pkg.contentType(part)
    const dot = part.lastIndexOf('.')
    const ext = dot < 0 ? '' : part.slice(dot + 1).toLowerCase()
    // A part typed by an Override needs its own; one typed by its extension's Default is covered.
    const root = this.pkg.root('[Content_Types].xml')
    const byDefault = root
      ?.childrenOf(NS.ct, 'Default')
      .some(
        (d) => (d.attr('Extension') ?? '').toLowerCase() === ext && d.attr('ContentType') === type
      )
    if (type && !byDefault) this.pkg.setOverride(copy, type)
    const rels = this.pkg.relationships(part)
    if (rels.length > 0) {
      const relsBytes = this.pkg.bytes(relsPartOf(part))
      if (relsBytes) this.pkg.write(relsPartOf(copy), relsBytes.slice())
      const relsRoot = this.pkg.rootForEdit(relsPartOf(copy))
      for (const el of relsRoot.childrenOf(NS.rels, 'Relationship')) {
        if (el.attr('TargetMode') === 'External') continue
        const target = this.pkg.canonical(resolveTarget(part, el.attr('Target') ?? ''))
        const type = el.attr('Type') ?? ''
        let to = target
        if (renames.has(target)) to = renames.get(target) as string
        else if (OWNED.has(type) && this.pkg.has(target)) to = this.copyPart(target, renames)
        // Targets are rewritten relative to the copy, which lives in the same directory.
        if (to !== target) el.setAttr('Target', relativeTarget(copy, to))
      }
    }
    return copy
  }

  /** A copy of slide `index` (notes, charts and diagrams copied too) inserted after it. */
  duplicateSlide(index: number): SlideRef {
    const source = this.slides()[index]
    if (!source) throw new Error(`no slide ${index}`)
    const renames = new Map<string, string>()
    // The copied notes page's link back to its slide is renamed with the rest,
    // so it points at the copy.
    const copy = this.copyPart(source.part, renames)
    // PowerPoint gives each slide its own creation id (co-authoring keys on it).
    const root = this.pkg.rootForEdit(copy)
    for (const el of root.descendants(NS.p14, 'creationId')) {
      el.setAttr('val', String(Math.floor(Math.random() * 0xfffffffe) + 1))
    }
    return this.register(copy, index + 1)
  }

  /** Remove slide `index`, and every part only it used (its notes, comments, charts, images). */
  deleteSlide(index: number): void {
    const slides = this.slides()
    const target = slides[index]
    if (!target) return
    const reachableBefore = this.reachable()
    const list = this.sldIdLstForEdit()
    for (const el of list.childrenOf(NS.p, 'sldId')) {
      if (Number(el.attr('id')) === target.id) el.remove()
    }
    this.pkg.removeRelationship(this.presPart, target.rId)
    this.dropFromCustomShows(target.rId)
    this.sections().remove(target.id)
    this.pkg.remove(target.part)
    this.pkg.remove(relsPartOf(target.part))
    this.pkg.removeOverride(target.part)
    // Parts nothing reaches any more (notes, comments, media only it used) go too.
    const reachableAfter = this.reachable()
    for (const part of reachableBefore) {
      if (reachableAfter.has(part) || !this.pkg.has(part)) continue
      this.pkg.remove(part)
      this.pkg.remove(relsPartOf(part))
      this.pkg.removeOverride(part)
    }
    this.dropLinksTo(target.part)
  }

  /** Move slide `from` so it ends at index `to`. */
  moveSlide(from: number, to: number): void {
    const slides = this.slides()
    if (from === to || !slides[from] || to < 0 || to >= slides.length) return
    const list = this.sldIdLstForEdit()
    const els = list.childrenOf(NS.p, 'sldId')
    const byId = (id: number) => els.find((e) => Number(e.attr('id')) === id) as XmlElement
    const moving = byId(slides[from].id)
    const order = slides.filter((_, i) => i !== from)
    if (to >= order.length) list.insertAfter(moving, byId(order[order.length - 1].id))
    else list.insertBefore(moving, byId(order[to].id))
    const after = this.slides()
    this.sections().move(
      slides[from].id,
      to > 0 ? after[to - 1].id : null,
      after.map((s) => s.id)
    )
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  /** The text of a slide's speaker notes ('' when it has none). */
  notesText(slidePart: string): string {
    const notes = this.notesOf(slidePart)
    const body = notes ? notesBody(this.pkg.root(notes) as XmlElement) : null
    if (!body) return ''
    const paras = body.childrenOf(NS.a, 'p').map((p) => paragraphText(p))
    while (paras.length && paras[paras.length - 1].trim() === '') paras.pop()
    return paras.join('\n')
  }

  /** Replace a slide's speaker notes with plain text, creating its notes page if needed. */
  setNotesText(slidePart: string, text: string): void {
    if (this.notesText(slidePart) === text) return
    let notes = this.notesOf(slidePart)
    if (!notes) {
      if (text === '') return
      notes = this.createNotes(slidePart)
    }
    const root = this.pkg.rootForEdit(notes)
    const body = notesBody(root)
    if (!body) return
    // Paragraph and run properties of the first paragraph carry over to every new one.
    const first = body.child(NS.a, 'p')
    const pPr = first?.child(NS.a, 'pPr')
    const rPr = first?.descendants(NS.a, 'rPr')[0] ?? null
    const lang = rPr?.attr('lang') ?? 'en-US'
    const paras = (text === '' ? [''] : text.split('\n')).map((line) => {
      const p = createElement(body, NS.a, 'p', 'a')
      if (pPr) p.append(pPr.clone())
      if (line !== '') {
        const r = createElement(p, NS.a, 'r', 'a')
        r.append(rPr ? rPr.clone() : createElement(r, NS.a, 'rPr', 'a', { lang, dirty: '0' }))
        const t = createElement(r, NS.a, 't', 'a')
        t.setText(line)
        r.append(t)
        p.append(r)
      } else {
        p.append(createElement(p, NS.a, 'endParaRPr', 'a', { lang, dirty: '0' }))
      }
      return p
    })
    const keep = body.elements().filter((e) => !e.is(NS.a, 'p'))
    body.replaceChildren([...keep, ...paras])
  }

  /** A deck that never had notes gets a notes master (and its theme) first. */
  private createNotesMaster(): string {
    const master = this.pkg.freeName('ppt/notesMasters/notesMaster{n}.xml')
    const theme = this.pkg.freeName('ppt/theme/theme{n}.xml')
    this.pkg.writeXml(theme, themeXml('Notes Theme'))
    this.pkg.setOverride(theme, CONTENT_TYPE.theme)
    this.pkg.writeXml(master, NOTES_MASTER_XML)
    this.pkg.setOverride(master, CONTENT_TYPE.notesMaster)
    this.pkg.addRelationship(master, REL.theme, theme)
    const rId = this.pkg.addRelationship(this.presPart, REL.notesMaster, master)
    const pres = this.pkg.rootForEdit(this.presPart)
    let list = pres.child(NS.p, 'notesMasterIdLst')
    if (!list) {
      // Schema order: sldMasterIdLst, notesMasterIdLst, handoutMasterIdLst, sldIdLst…
      list = createElement(pres, NS.p, 'notesMasterIdLst', 'p')
      const after = pres.child(NS.p, 'sldMasterIdLst')
      if (after) pres.insertAfter(list, after)
      else pres.insert(list, 0)
    }
    const el = createElement(list, NS.p, 'notesMasterId', 'p')
    const rPrefix = list.lookupPrefix(NS.r)
    if (rPrefix === null) el.setAttr('xmlns:r', NS.r)
    el.attrs.push({ name: `${rPrefix ?? 'r'}:id`, raw: escapeAttr(rId, '"'), quote: '"' })
    list.append(el)
    return master
  }

  private createNotes(slidePart: string): string {
    const master = this.notesMaster() ?? this.createNotesMaster()
    const part = this.pkg.freeName('ppt/notesSlides/notesSlide{n}.xml')
    this.pkg.writeXml(
      part,
      `<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>` +
        `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
        `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
        `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>` +
        `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
    )
    this.pkg.setOverride(part, CONTENT_TYPE.notesSlide)
    this.pkg.addRelationship(part, REL.notesMaster, master)
    this.pkg.addRelationship(part, REL.slide, slidePart)
    this.pkg.addRelationship(slidePart, REL.notesSlide, part)
    return part
  }

  // ── Housekeeping ───────────────────────────────────────────────────────────

  /** Every part reachable from the package's root through internal relationships. */
  reachable(): Set<string> {
    const seen = new Set<string>()
    const queue = ['']
    while (queue.length) {
      const part = queue.pop() as string
      for (const rel of this.pkg.relationships(part)) {
        if (rel.external) continue
        const to = this.pkg.canonical(resolveTarget(part, rel.target))
        if (seen.has(to) || !this.pkg.has(to)) continue
        seen.add(to)
        queue.push(to)
      }
    }
    return seen
  }

  /**
   * Hyperlinks elsewhere that jumped to a removed slide would leave a
   * relationship to a missing part, which PowerPoint repairs on open: the link
   * and its relationship go.
   */
  private dropLinksTo(removed: string): void {
    for (const part of this.pkg.partNames()) {
      if (part.endsWith('.rels') || !this.pkg.has(relsPartOf(part))) continue
      const ids = this.pkg
        .relationships(part)
        .filter((r) => !r.external && this.pkg.canonical(resolveTarget(part, r.target)) === removed)
        .map((r) => r.id)
      if (ids.length === 0) continue
      const root = this.pkg.rootForEdit(part)
      for (const id of ids) {
        for (const tag of ['hlinkClick', 'hlinkHover', 'hlinkMouseOver']) {
          for (const el of root.descendants(NS.a, tag)) {
            if (el.attrNS(NS.r, 'id') === id) el.remove()
          }
        }
        this.pkg.removeRelationship(part, id)
      }
    }
  }

  private dropFromCustomShows(rId: string): void {
    const shows = this.pres.child(NS.p, 'custShowLst')
    if (!shows) return
    const hits = shows.descendants(NS.p, 'sld').filter((el) => el.attrNS(NS.r, 'id') === rId)
    if (hits.length === 0) return
    this.pkg.touch(this.presPart)
    for (const el of hits) el.remove()
  }

  private sections(): Sections {
    return new Sections(this)
  }

  /** @internal for Sections */
  presForEdit(): XmlElement {
    return this.pkg.rootForEdit(this.presPart)
  }

  /** @internal for Sections */
  presRoot(): XmlElement {
    return this.pres
  }
}

/** The body placeholder of a notes page. */
export function notesBody(notesRoot: XmlElement): XmlElement | null {
  const tree = spTree(notesRoot)
  if (!tree) return null
  for (const sp of childShapes(tree)) {
    const ph = placeholderOf(sp)
    if (ph && ph.type === 'body') return sp.child(NS.p, 'txBody')
  }
  return null
}

/** The visible text of a paragraph: runs, fields and line breaks. */
export function paragraphText(p: XmlElement): string {
  let s = ''
  for (const c of p.elements()) {
    if (c.is(NS.a, 'r') || c.is(NS.a, 'fld')) s += c.child(NS.a, 't')?.textContent() ?? ''
    else if (c.is(NS.a, 'br')) s += '\n'
  }
  return s
}

/**
 * PowerPoint 2010 sections (`p14:sectionLst` in the presentation's extLst)
 * list slides by id. They have to keep naming every slide exactly once, in
 * show order, or PowerPoint repairs the file.
 */
class Sections {
  private deck: Deck
  constructor(deck: Deck) {
    this.deck = deck
  }

  private list(edit: boolean): XmlElement | null {
    const pres = edit ? this.deck.presForEdit() : this.deck.presRoot()
    for (const ext of pres.child(NS.p, 'extLst')?.childrenOf(NS.p, 'ext') ?? []) {
      const lst = ext.child(NS.p14, 'sectionLst')
      if (lst) return lst
    }
    return null
  }

  private sectionIds(section: XmlElement): XmlElement | null {
    return section.child(NS.p14, 'sldIdLst')
  }

  /** A new slide joins the section of the slide before it (the first section at the top). */
  placeNew(id: number, prevId: number | null): void {
    if (!this.list(false)) return
    const lst = this.list(true) as XmlElement
    const sections = lst.childrenOf(NS.p14, 'section')
    if (sections.length === 0) return
    let target = sections[0]
    let anchor: XmlElement | null = null
    if (prevId !== null) {
      for (const s of sections) {
        const hit = this.sectionIds(s)
          ?.childrenOf(NS.p14, 'sldId')
          .find((e) => Number(e.attr('id')) === prevId)
        if (hit) {
          target = s
          anchor = hit
        }
      }
    }
    let ids = this.sectionIds(target)
    if (!ids) {
      ids = createElement(target, NS.p14, 'sldIdLst', 'p14')
      target.append(ids)
    }
    const el = createElement(ids, NS.p14, 'sldId', 'p14', { id: String(id) })
    if (anchor) ids.insertAfter(el, anchor)
    else ids.insert(el, 0)
  }

  remove(id: number): void {
    if (!this.list(false)) return
    const lst = this.list(true) as XmlElement
    for (const el of lst.descendants(NS.p14, 'sldId')) if (Number(el.attr('id')) === id) el.remove()
  }

  /** After a move: the slide joins the section of the slide now before it; lists follow show order. */
  move(id: number, prevId: number | null, order: number[]): void {
    if (!this.list(false)) return
    this.remove(id)
    this.placeNew(id, prevId)
    const lst = this.list(true) as XmlElement
    const rank = new Map(order.map((sid, i) => [sid, i]))
    for (const s of lst.childrenOf(NS.p14, 'section')) {
      const ids = this.sectionIds(s)
      if (!ids) continue
      const els = ids.childrenOf(NS.p14, 'sldId')
      const sorted = [...els].sort(
        (a, b) => (rank.get(Number(a.attr('id'))) ?? 0) - (rank.get(Number(b.attr('id'))) ?? 0)
      )
      if (sorted.some((e, i) => e !== els[i])) {
        const others = ids.elements().filter((e) => !e.is(NS.p14, 'sldId'))
        ids.replaceChildren([...sorted, ...others])
      }
    }
  }
}
