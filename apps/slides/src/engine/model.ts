/**
 * The render model: what a slide looks like, resolved from its XML through
 * the layout, master, theme and presentation defaults. The view draws this;
 * the editor reads boxes and text from it and writes back to the XML.
 *
 * Inheritance follows ECMA-376 Part 1 §19.3.1 / §21.1.2: a placeholder takes
 * its frame, geometry, fills and text styles from the matching layout
 * placeholder, which takes them from the master's; text levels stack the
 * presentation's default style, the master's title/body/other style, the
 * master and layout placeholders' list styles, the shape's own, then the
 * paragraph and the run.
 */
import {
  BLACK,
  colorChild,
  DEFAULT_COLOR_MAP,
  readColorMap,
  readScheme,
  resolveColor,
  schemeColor,
  type ColorContext,
  type Rgba,
} from './color.ts'
import type { Deck } from './deck.ts'
import { readAdjust } from './geometry.ts'
import { NS, REL } from './ns.ts'
import { resolveTarget } from './opc.ts'
import {
  childShapes,
  drawable,
  matchLayoutPlaceholder,
  matchMasterPlaceholder,
  placeholderOf,
  readXfrm,
  shapeId,
  shapeKind,
  shapeName,
  spTree,
  xfrmElement,
  type Placeholder,
  type Xfrm,
} from './shapes.ts'
import type { XmlElement } from './xml.ts'

// ── Types ────────────────────────────────────────────────────────────────────

export type Fill =
  | { kind: 'none' }
  | { kind: 'solid'; color: Rgba }
  | { kind: 'gradient'; stops: { pos: number; color: Rgba }[]; angle: number; radial: boolean }
  | { kind: 'image'; src: string | null; tile: boolean }
  | { kind: 'pattern'; fg: Rgba; bg: Rgba }

export type Line = {
  fill: Fill
  /** EMU. */
  width: number
  dash: string
  head: string | null
  tail: string | null
}

export type Geometry =
  | { kind: 'preset'; name: string; adjust: Record<string, number> }
  | { kind: 'custom'; el: XmlElement }

export type RunStyle = {
  sizePt: number
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: Rgba
  font: string
  /** Percent, +30000 for superscript. */
  baseline: number
  caps: 'none' | 'all' | 'small'
  highlight: Rgba | null
  link: boolean
}

export type Run =
  | { kind: 'text'; text: string; style: RunStyle; rPr: XmlElement | null; el: XmlElement }
  | { kind: 'br'; style: RunStyle; rPr: XmlElement | null; el: XmlElement }
  | {
      kind: 'field'
      text: string
      fieldType: string
      style: RunStyle
      rPr: XmlElement | null
      el: XmlElement
    }

export type Spacing = { pct?: number; pts?: number }

export type Bullet =
  | { kind: 'char'; char: string; font: string | null; color: Rgba | null; sizePct: number }
  | { kind: 'number'; text: string; font: string | null; color: Rgba | null; sizePct: number }

export type Paragraph = {
  runs: Run[]
  align: 'l' | 'ctr' | 'r' | 'just' | 'dist'
  /** EMU. */
  marL: number
  indent: number
  level: number
  lineSpacing: Spacing
  spaceBefore: Spacing
  spaceAfter: Spacing
  bullet: Bullet | null
  /** Run style an empty paragraph (and typed text) gets. */
  endStyle: RunStyle
  rtl: boolean
  el: XmlElement | null
}

export type TextBody = {
  paragraphs: Paragraph[]
  anchor: 't' | 'ctr' | 'b'
  anchorCtr: boolean
  /** EMU. */
  insets: { l: number; t: number; r: number; b: number }
  wrap: boolean
  vert: string
  /** 1 = no shrink. */
  fontScale: number
  lineReduction: number
  body: XmlElement | null
}

export type ShapeModel = {
  /** Unique in a rendered slide: origin and id. */
  key: string
  id: string
  name: string
  origin: 'master' | 'layout' | 'slide'
  kind: 'shape' | 'picture' | 'group' | 'table' | 'chart' | 'object' | 'unknown'
  /** EMU, in the parent's coordinate space. */
  box: Xfrm
  geometry: Geometry
  fill: Fill
  line: Line | null
  text: TextBody | null
  image: {
    src: string | null
    crop: { l: number; t: number; r: number; b: number }
    label: string
  } | null
  children: ShapeModel[]
  /** A group's child coordinate space. */
  childSpace: { x: number; y: number; cx: number; cy: number } | null
  table: TableModel | null
  placeholder: Placeholder | null
  /** An empty placeholder: drawn only in the editor, with its prompt. */
  prompt: string | null
  /** True for `cxnSp` and line presets: no fill, selected by their line. */
  isLine: boolean
  /** The outer XML element (slide shapes only; the editor writes through it). */
  el: XmlElement | null
}

export type TableModel = {
  cols: number[]
  rows: { height: number; cells: TableCell[] }[]
}

export type TableCell = {
  text: TextBody
  fill: Fill
  borders: { l: Line | null; r: Line | null; t: Line | null; b: Line | null }
  gridSpan: number
  rowSpan: number
  merged: boolean
}

export type SlideModel = {
  part: string
  number: number
  size: { cx: number; cy: number }
  background: Fill
  shapes: ShapeModel[]
  hidden: boolean
}

// ── Media ────────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}

function base64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

/**
 * Images as `data:` URLs. Not `blob:`: exporting a slide as PNG inlines every
 * image by fetching it, and the desktop's CSP (`connect-src 'self'`) refuses a
 * fetch of a blob: URL. Cached per part.
 */
export class MediaCache {
  private cache = new Map<string, string | null>()
  private readonly deck: { pkg: Deck['pkg'] }
  constructor(deck: { pkg: Deck['pkg'] }) {
    this.deck = deck
  }

  src(part: string): string | null {
    if (this.cache.has(part)) return this.cache.get(part) ?? null
    const dot = part.lastIndexOf('.')
    const mime = MIME[part.slice(dot + 1).toLowerCase()]
    const bytes = this.deck.pkg.bytes(part)
    const url = mime && bytes ? `data:${mime};base64,${base64(bytes)}` : null
    this.cache.set(part, url)
    return url
  }

  forget(part: string): void {
    this.cache.delete(part)
  }
}

// ── Theme ────────────────────────────────────────────────────────────────────

export type ThemeModel = {
  scheme: Record<string, string>
  majorFont: string
  minorFont: string
  majorEa: string
  minorEa: string
  fillStyles: XmlElement[]
  lineStyles: XmlElement[]
  bgFillStyles: XmlElement[]
}

export function readTheme(root: XmlElement | null): ThemeModel {
  const el = root?.child(NS.a, 'themeElements') ?? null
  const fonts = el?.child(NS.a, 'fontScheme') ?? null
  const fmt = el?.child(NS.a, 'fmtScheme') ?? null
  const face = (kind: string, script: string) =>
    fonts?.child(NS.a, kind)?.child(NS.a, script)?.attr('typeface') ?? ''
  return {
    scheme: readScheme(el?.child(NS.a, 'clrScheme') ?? null),
    majorFont: face('majorFont', 'latin') || 'Calibri Light',
    minorFont: face('minorFont', 'latin') || 'Calibri',
    majorEa: face('majorFont', 'ea'),
    minorEa: face('minorFont', 'ea'),
    fillStyles: fmt?.child(NS.a, 'fillStyleLst')?.elements() ?? [],
    lineStyles: fmt?.child(NS.a, 'lnStyleLst')?.childrenOf(NS.a, 'ln') ?? [],
    bgFillStyles: fmt?.child(NS.a, 'bgFillStyleLst')?.elements() ?? [],
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

type Layer = { part: string; root: XmlElement; tree: XmlElement | null }

export type SlideContext = {
  deck: Deck
  media: MediaCache
  slide: Layer
  layout: Layer | null
  master: Layer | null
  theme: ThemeModel
  colors: ColorContext
  number: number
  /** Notes pages draw with the notes master's notesStyle. */
  notes?: boolean
}

function layer(deck: Deck, part: string | null): Layer | null {
  if (!part) return null
  const root = deck.pkg.root(part)
  return root ? { part, root, tree: spTree(root) } : null
}

/** The context every shape of a slide resolves against. */
export function slideContext(
  deck: Deck,
  slidePart: string,
  number: number,
  media: MediaCache
): SlideContext {
  const slide = layer(deck, slidePart) as Layer
  const layoutPart = slide.root.is(NS.p, 'sld') ? deck.layoutOf(slidePart) : null
  const layout = layer(deck, layoutPart)
  const masterPart = layoutPart
    ? deck.masterOf(layoutPart)
    : slide.root.is(NS.p, 'sldLayout')
      ? deck.masterOf(slidePart)
      : slide.root.is(NS.p, 'notes')
        ? deck.notesMaster()
        : null
  const master = layer(deck, masterPart)
  const themePart = masterPart ? deck.themeOf(masterPart) : null
  const theme = readTheme(themePart ? deck.pkg.root(themePart) : null)
  let map = readColorMap(master?.root.child(NS.p, 'clrMap') ?? null, DEFAULT_COLOR_MAP)
  for (const l of [layout, slide]) {
    const over = l?.root.child(NS.p, 'clrMapOvr')?.child(NS.a, 'overrideClrMapping')
    if (over) map = readColorMap(over, map)
  }
  return {
    deck,
    media,
    slide,
    layout,
    master,
    theme,
    colors: { scheme: theme.scheme, map },
    number,
    notes: slide.root.is(NS.p, 'notes'),
  }
}

// ── Fills and lines ──────────────────────────────────────────────────────────

const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']

/** The fill element among a properties element's children. */
function fillElement(props: XmlElement | null): XmlElement | null {
  if (!props) return null
  return props.elements().find((c) => c.ns === NS.a && FILL_TAGS.includes(c.local)) ?? null
}

/** Resolve a fill element. `part` resolves image relationships. */
export function readFill(
  el: XmlElement | null,
  ctx: SlideContext,
  part: string,
  colors = ctx.colors
): Fill | null {
  if (!el) return null
  switch (el.local) {
    case 'noFill':
      return { kind: 'none' }
    case 'solidFill': {
      const color = resolveColor(colorChild(el), colors)
      return color ? { kind: 'solid', color } : { kind: 'none' }
    }
    case 'gradFill': {
      const stops = (el.child(NS.a, 'gsLst')?.childrenOf(NS.a, 'gs') ?? [])
        .map((gs) => ({
          pos: (Number(gs.attr('pos')) || 0) / 100000,
          color: resolveColor(colorChild(gs), colors) ?? BLACK,
        }))
        .sort((a, b) => a.pos - b.pos)
      if (stops.length === 0) return { kind: 'none' }
      const lin = el.child(NS.a, 'lin')
      const path = el.child(NS.a, 'path')
      return {
        kind: 'gradient',
        stops,
        angle: lin ? (Number(lin.attr('ang')) || 0) / 60000 : 90,
        radial: !!path,
      }
    }
    case 'blipFill': {
      const blip = el.child(NS.a, 'blip')
      const embed = blip?.attrNS(NS.r, 'embed')
      const target = embed ? ctx.deck.pkg.target(part, embed) : null
      return {
        kind: 'image',
        src: target ? ctx.media.src(target) : null,
        tile: !!el.child(NS.a, 'tile'),
      }
    }
    case 'pattFill': {
      const fg = resolveColor(colorChild(el.child(NS.a, 'fgClr')), colors) ?? BLACK
      const bg = resolveColor(colorChild(el.child(NS.a, 'bgClr')), colors) ?? {
        r: 255,
        g: 255,
        b: 255,
        a: 1,
      }
      return { kind: 'pattern', fg, bg }
    }
    default:
      return null
  }
}

function readLine(
  ln: XmlElement | null,
  ctx: SlideContext,
  part: string,
  colors = ctx.colors
): Partial<Line> | null {
  if (!ln) return null
  const out: Partial<Line> = {}
  const w = ln.attr('w')
  if (w !== null) out.width = Number(w) || 0
  const fill = readFill(fillElement(ln), ctx, part, colors)
  if (fill) out.fill = fill
  const dash = ln.child(NS.a, 'prstDash')?.attr('val')
  if (dash) out.dash = dash
  const head = ln.child(NS.a, 'headEnd')?.attr('type')
  if (head) out.head = head === 'none' ? null : head
  const tail = ln.child(NS.a, 'tailEnd')?.attr('type')
  if (tail) out.tail = tail === 'none' ? null : tail
  return out
}

/** A style matrix reference (`a:fillRef idx="2"`) → the theme's fill with phClr bound. */
function styleFill(ref: XmlElement | null, ctx: SlideContext, part: string): Fill | null {
  if (!ref) return null
  const idx = Number(ref.attr('idx'))
  if (!idx) return { kind: 'none' }
  const phClr = resolveColor(colorChild(ref), ctx.colors)
  const list = idx >= 1001 ? ctx.theme.bgFillStyles : ctx.theme.fillStyles
  const el = list[idx >= 1001 ? idx - 1001 : idx - 1] ?? null
  return readFill(el, ctx, part, { ...ctx.colors, phClr })
}

function styleLine(ref: XmlElement | null, ctx: SlideContext, part: string): Partial<Line> | null {
  if (!ref) return null
  const idx = Number(ref.attr('idx'))
  if (!idx) return { fill: { kind: 'none' } }
  const phClr = resolveColor(colorChild(ref), ctx.colors)
  return readLine(ctx.theme.lineStyles[idx - 1] ?? null, ctx, part, { ...ctx.colors, phClr })
}

// ── Text ─────────────────────────────────────────────────────────────────────

type ParaProps = {
  attrs: Record<string, string>
  lnSpc: XmlElement | null
  spcBef: XmlElement | null
  spcAft: XmlElement | null
  buColor: XmlElement | null | 'text'
  buSize: XmlElement | null | 'text'
  buFont: XmlElement | null | 'text'
  buType: XmlElement | null
  defRPr: XmlElement[]
}

const emptyProps = (): ParaProps => ({
  attrs: {},
  lnSpc: null,
  spcBef: null,
  spcAft: null,
  buColor: null,
  buSize: null,
  buFont: null,
  buType: null,
  defRPr: [],
})

function mergePPr(into: ParaProps, pPr: XmlElement | null): ParaProps {
  if (!pPr) return into
  const out: ParaProps = { ...into, attrs: { ...into.attrs }, defRPr: [...into.defRPr] }
  for (const a of pPr.attrs)
    if (!a.name.includes(':')) out.attrs[a.name] = pPr.attr(a.name) as string
  for (const c of pPr.elements()) {
    switch (c.local) {
      case 'lnSpc':
        out.lnSpc = c
        break
      case 'spcBef':
        out.spcBef = c
        break
      case 'spcAft':
        out.spcAft = c
        break
      case 'buClrTx':
        out.buColor = 'text'
        break
      case 'buClr':
        out.buColor = c
        break
      case 'buSzTx':
        out.buSize = 'text'
        break
      case 'buSzPct':
      case 'buSzPts':
        out.buSize = c
        break
      case 'buFontTx':
        out.buFont = 'text'
        break
      case 'buFont':
        out.buFont = c
        break
      case 'buNone':
      case 'buAutoNum':
      case 'buChar':
      case 'buBlip':
        out.buType = c
        break
      case 'defRPr':
        out.defRPr.push(c)
        break
    }
  }
  return out
}

/** Text style sources of a shape, lowest priority first, per level (0–8). */
type TextSources = {
  levels: XmlElement[][]
  bodyPr: XmlElement[]
  fontRef: XmlElement | null
  /** Table style text (`a:tcTxStyle`), applied over the levels. */
  tableText?: XmlElement[]
}

function addListStyle(levels: XmlElement[][], lst: XmlElement | null) {
  if (!lst) return
  const def = lst.child(NS.a, 'defPPr')
  for (let i = 0; i < 9; i++) {
    if (def) levels[i].push(def)
    const lvl = lst.child(NS.a, `lvl${i + 1}pPr`)
    if (lvl) levels[i].push(lvl)
  }
}

function masterStyleFor(ctx: SlideContext, ph: Placeholder | null): XmlElement | null {
  const styles = ctx.master?.root.child(NS.p, 'txStyles')
  if (ctx.notes) return ctx.master?.root.child(NS.p, 'notesStyle') ?? null
  if (!styles) return null
  // A shape that is not a placeholder takes the presentation's default text
  // style only (PowerPoint and LibreOffice agree; otherStyle is not stacked on it).
  if (!ph) return null
  if (ph.type === 'title' || ph.type === 'ctrTitle') return styles.child(NS.p, 'titleStyle')
  if (ph.type === 'dt' || ph.type === 'ftr' || ph.type === 'sldNum')
    return styles.child(NS.p, 'otherStyle')
  return styles.child(NS.p, 'bodyStyle')
}

function txBodyOf(el: XmlElement | null): XmlElement | null {
  const d = el ? drawable(el) : null
  return d?.child(d.ns as string, 'txBody') ?? null
}

type Inherited = { el: XmlElement; part: string }

/** The shapes a placeholder on `origin` inherits from, master first. */
function inheritedShapes(
  ctx: SlideContext,
  origin: ShapeModel['origin'],
  ph: Placeholder | null
): Inherited[] {
  if (!ph) return []
  const out: Inherited[] = []
  let type = ph.type
  if (origin === 'slide' && ctx.layout?.tree && !ctx.notes) {
    const l = matchLayoutPlaceholder(ctx.layout.tree, ph)
    if (l) {
      out.push({ el: l, part: ctx.layout.part })
      type = placeholderOf(l)?.type ?? type
    }
  }
  if ((origin === 'slide' || origin === 'layout') && ctx.master?.tree) {
    const m = ctx.notes
      ? (childShapes(ctx.master.tree).find((s) => placeholderOf(s)?.type === type) ?? null)
      : matchMasterPlaceholder(ctx.master.tree, type)
    if (m) out.push({ el: m, part: ctx.master.part })
  }
  return out.reverse()
}

function textSources(
  ctx: SlideContext,
  el: XmlElement,
  origin: ShapeModel['origin'],
  ph: Placeholder | null
): TextSources {
  const levels: XmlElement[][] = Array.from({ length: 9 }, () => [])
  const pres = ctx.deck.pkg.root(ctx.deck.presPart)
  if (!ctx.notes) addListStyle(levels, pres?.child(NS.p, 'defaultTextStyle') ?? null)
  addListStyle(levels, masterStyleFor(ctx, ph))
  const bodyPr: XmlElement[] = []
  for (const inherited of inheritedShapes(ctx, origin, ph)) {
    const body = txBodyOf(inherited.el)
    addListStyle(levels, body?.child(NS.a, 'lstStyle') ?? null)
    const bp = body?.child(NS.a, 'bodyPr')
    if (bp) bodyPr.push(bp)
  }
  const own = txBodyOf(el)
  addListStyle(levels, own?.child(NS.a, 'lstStyle') ?? null)
  const bp = own?.child(NS.a, 'bodyPr')
  if (bp) bodyPr.push(bp)
  const d = drawable(el)
  const fontRef = d?.child(d.ns as string, 'style')?.child(NS.a, 'fontRef') ?? null
  return { levels, bodyPr, fontRef }
}

function resolveFont(face: string | null, ctx: SlideContext): string | null {
  if (!face) return null
  switch (face) {
    case '+mj-lt':
      return ctx.theme.majorFont
    case '+mn-lt':
      return ctx.theme.minorFont
    case '+mj-ea':
      return ctx.theme.majorEa || ctx.theme.majorFont
    case '+mn-ea':
      return ctx.theme.minorEa || ctx.theme.minorFont
    case '+mj-cs':
      return ctx.theme.majorFont
    case '+mn-cs':
      return ctx.theme.minorFont
    default:
      return face
  }
}

function applyRPr(style: RunStyle, rPr: XmlElement | null, ctx: SlideContext): RunStyle {
  if (!rPr) return style
  const s = { ...style }
  const sz = rPr.attr('sz')
  if (sz !== null && Number(sz) > 0) s.sizePt = Number(sz) / 100
  const b = rPr.attr('b')
  if (b !== null) s.bold = b === '1' || b === 'true'
  const i = rPr.attr('i')
  if (i !== null) s.italic = i === '1' || i === 'true'
  const u = rPr.attr('u')
  if (u !== null) s.underline = u !== 'none'
  const strike = rPr.attr('strike')
  if (strike !== null) s.strike = strike !== 'noStrike'
  const baseline = rPr.attr('baseline')
  if (baseline !== null) s.baseline = Number(baseline) || 0
  const cap = rPr.attr('cap')
  if (cap === 'all' || cap === 'small' || cap === 'none') s.caps = cap
  const fill = fillElement(rPr)
  if (fill) {
    const f = readFill(fill, ctx, ctx.slide.part)
    if (f?.kind === 'solid') s.color = f.color
    else if (f?.kind === 'gradient') s.color = f.stops[0].color
    else if (f?.kind === 'none') s.color = { ...s.color, a: 0 }
  }
  const latin = resolveFont(rPr.child(NS.a, 'latin')?.attr('typeface') ?? null, ctx)
  if (latin) s.font = latin
  else {
    const ea = resolveFont(rPr.child(NS.a, 'ea')?.attr('typeface') ?? null, ctx)
    if (ea && !s.font) s.font = ea
  }
  const hl = rPr.child(NS.a, 'highlight')
  if (hl) s.highlight = resolveColor(colorChild(hl), ctx.colors)
  if (rPr.child(NS.a, 'hlinkClick')) {
    s.link = true
    s.underline = true
    s.color = schemeColor('hlink', ctx.colors) ?? s.color
  }
  return s
}

function spacing(el: XmlElement | null): Spacing {
  if (!el) return {}
  const pct = el.child(NS.a, 'spcPct')?.attr('val')
  if (pct !== null && pct !== undefined) return { pct: Number(pct) / 100000 }
  const pts = el.child(NS.a, 'spcPts')?.attr('val')
  if (pts !== null && pts !== undefined) return { pts: Number(pts) / 100 }
  return {}
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

function roman(n: number): string {
  let s = ''
  let x = n
  for (const [v, r] of ROMAN)
    while (x >= v) {
      s += r
      x -= v
    }
  return s
}

function alpha(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    x--
    s = String.fromCharCode(97 + (x % 26)) + s
    x = Math.floor(x / 26)
  }
  return s
}

/** `arabicPeriod`, `romanUcParenR`, `alphaLcParenBoth`, … → label for `n`. */
export function autoNumberLabel(type: string, n: number): string {
  const m = /^(arabic|romanUc|romanLc|alphaUc|alphaLc)(.*)$/.exec(type) ?? [
    type,
    'arabic',
    'Period',
  ]
  const kind = m[1]
  const suffix = m[2]
  let num =
    kind === 'arabic'
      ? String(n)
      : kind === 'romanUc'
        ? roman(n).toUpperCase()
        : kind === 'romanLc'
          ? roman(n)
          : kind === 'alphaUc'
            ? alpha(n).toUpperCase()
            : alpha(n)
  if (/ParenBoth/.test(suffix)) num = `(${num})`
  else if (/ParenR/.test(suffix)) num = `${num})`
  else if (/Period/.test(suffix)) num = `${num}.`
  else if (/Minus/.test(suffix)) num = `- ${num} -`
  return num
}

function defaultRunStyle(ctx: SlideContext): RunStyle {
  return {
    sizePt: 18,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: schemeColor('tx1', ctx.colors) ?? BLACK,
    font: ctx.theme.minorFont,
    baseline: 0,
    caps: 'none',
    highlight: null,
    link: false,
  }
}

function buildTextBody(
  body: XmlElement | null,
  sources: TextSources,
  ctx: SlideContext,
  fieldText: (type: string, cached: string) => string
): TextBody {
  // Body properties: inherited first, the shape's own last.
  const bodyAttrs: Record<string, string> = {}
  let autofit: XmlElement | null = null
  for (const bp of sources.bodyPr) {
    for (const a of bp.attrs)
      if (!a.name.includes(':')) bodyAttrs[a.name] = bp.attr(a.name) as string
    const fit = bp
      .elements()
      .find((c) => ['normAutofit', 'spAutoFit', 'noAutofit'].includes(c.local))
    if (fit) autofit = fit
  }
  const ins = (k: string, d: number) => {
    const v = Number(bodyAttrs[k])
    return Number.isFinite(v) && bodyAttrs[k] !== undefined ? v : d
  }
  const fontScale =
    autofit?.local === 'normAutofit' ? (Number(autofit.attr('fontScale')) || 100000) / 100000 : 1
  const lineReduction =
    autofit?.local === 'normAutofit' ? (Number(autofit.attr('lnSpcReduction')) || 0) / 100000 : 0

  // The shape's style fontRef sets a base font and colour for its runs.
  let base = defaultRunStyle(ctx)
  const levelProps = sources.levels.map((list) => list.reduce(mergePPr, emptyProps()))
  const paragraphs: Paragraph[] = []
  const counters: number[] = Array(9).fill(0)
  const counterType: (string | null)[] = Array(9).fill(null)

  for (const p of body?.childrenOf(NS.a, 'p') ?? []) {
    const pPr = p.child(NS.a, 'pPr')
    const level = Math.min(8, Math.max(0, Number(pPr?.attr('lvl') ?? 0) || 0))
    const props = mergePPr(levelProps[level], pPr)
    let style = base
    for (const d of props.defRPr.slice(
      0,
      props.defRPr.length - (pPr?.child(NS.a, 'defRPr') ? 1 : 0)
    )) {
      style = applyRPr(style, d, ctx)
    }
    if (sources.fontRef) {
      const fr = sources.fontRef
      const face =
        fr.attr('idx') === 'major'
          ? ctx.theme.majorFont
          : fr.attr('idx') === 'minor'
            ? ctx.theme.minorFont
            : null
      if (face) style = { ...style, font: face }
      const c = resolveColor(colorChild(fr), ctx.colors)
      if (c) style = { ...style, color: c }
    }
    // The paragraph's own defRPr (rare) and any extra table-style run properties.
    const own = pPr?.child(NS.a, 'defRPr') ?? null
    if (own) style = applyRPr(style, own, ctx)
    for (const tx of sources.tableText ?? []) style = applyTableText(style, tx, ctx)

    const runs: Run[] = []
    for (const c of p.elements()) {
      if (c.is(NS.a, 'r')) {
        const rPr = c.child(NS.a, 'rPr')
        runs.push({
          kind: 'text',
          text: c.child(NS.a, 't')?.textContent() ?? '',
          style: applyRPr(style, rPr, ctx),
          rPr,
          el: c,
        })
      } else if (c.is(NS.a, 'br')) {
        const rPr = c.child(NS.a, 'rPr')
        runs.push({ kind: 'br', style: applyRPr(style, rPr, ctx), rPr, el: c })
      } else if (c.is(NS.a, 'fld')) {
        const rPr = c.child(NS.a, 'rPr')
        const type = c.attr('type') ?? ''
        runs.push({
          kind: 'field',
          fieldType: type,
          text: fieldText(type, c.child(NS.a, 't')?.textContent() ?? ''),
          style: applyRPr(style, rPr, ctx),
          rPr,
          el: c,
        })
      }
    }
    const endStyle = applyRPr(style, p.child(NS.a, 'endParaRPr'), ctx)
    const hasText = runs.some((r) => (r.kind === 'text' || r.kind === 'field') && r.text !== '')

    // Bullets.
    let bullet: Bullet | null = null
    const bu = props.buType
    for (let l = level + 1; l < 9; l++) {
      counters[l] = 0
      counterType[l] = null
    }
    if (bu && hasText && bu.local !== 'buNone') {
      const firstStyle = runs.find((r) => r.kind !== 'br')?.style ?? endStyle
      const color =
        props.buColor && props.buColor !== 'text'
          ? resolveColor(colorChild(props.buColor), ctx.colors)
          : null
      const sizePct =
        props.buSize && props.buSize !== 'text'
          ? props.buSize.local === 'buSzPct'
            ? (Number(props.buSize.attr('val')) || 100000) / 100000
            : (Number(props.buSize.attr('val')) || 0) / 100 / (firstStyle.sizePt || 18)
          : 1
      const font =
        props.buFont && props.buFont !== 'text'
          ? resolveFont(props.buFont.attr('typeface'), ctx)
          : null
      if (bu.local === 'buChar') {
        bullet = { kind: 'char', char: bu.attr('char') ?? '•', font, color, sizePct }
        counters[level] = 0
      } else if (bu.local === 'buAutoNum') {
        const type = bu.attr('type') ?? 'arabicPeriod'
        const start = Number(bu.attr('startAt')) || 1
        if (counterType[level] !== type) counters[level] = 0
        counterType[level] = type
        counters[level]++
        bullet = {
          kind: 'number',
          text: autoNumberLabel(type, start + counters[level] - 1),
          font,
          color,
          sizePct,
        }
      } else {
        bullet = { kind: 'char', char: '•', font: null, color, sizePct }
      }
    } else if (!bu || bu.local === 'buNone') {
      if (hasText) {
        counters[level] = 0
        counterType[level] = null
      }
    }

    const algn = props.attrs.algn
    paragraphs.push({
      runs,
      align: algn === 'ctr' || algn === 'r' || algn === 'just' || algn === 'dist' ? algn : 'l',
      marL: Number(props.attrs.marL) || 0,
      indent: Number(props.attrs.indent) || 0,
      level,
      lineSpacing: spacing(props.lnSpc),
      spaceBefore: spacing(props.spcBef),
      spaceAfter: spacing(props.spcAft),
      bullet,
      endStyle,
      rtl: props.attrs.rtl === '1',
      el: p,
    })
    base = defaultRunStyle(ctx)
  }

  const anchor = bodyAttrs.anchor === 'ctr' || bodyAttrs.anchor === 'b' ? bodyAttrs.anchor : 't'
  return {
    paragraphs,
    anchor,
    anchorCtr: bodyAttrs.anchorCtr === '1',
    insets: {
      l: ins('lIns', 91440),
      t: ins('tIns', 45720),
      r: ins('rIns', 91440),
      b: ins('bIns', 45720),
    },
    wrap: bodyAttrs.wrap !== 'none',
    vert: bodyAttrs.vert ?? 'horz',
    fontScale,
    lineReduction,
    body,
  }
}

// ── Shapes ───────────────────────────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  title: 'Click to add title',
  ctrTitle: 'Click to add title',
  subTitle: 'Click to add subtitle',
  body: 'Click to add text',
  obj: 'Click to add text',
  pic: 'Click to add picture',
  chart: 'Click to add chart',
  tbl: 'Click to add table',
  media: 'Click to add media',
  dgm: 'Click to add SmartArt',
  clipArt: 'Click to add picture',
}

function propsOf(el: XmlElement): XmlElement | null {
  const kind = shapeKind(el)
  if (!kind) return null
  return el.child(el.ns as string, kind === 'grpSp' ? 'grpSpPr' : 'spPr')
}

function geometryOf(props: XmlElement | null): Geometry | null {
  const prst = props?.child(NS.a, 'prstGeom')
  if (prst) return { kind: 'preset', name: prst.attr('prst') ?? 'rect', adjust: readAdjust(prst) }
  const cust = props?.child(NS.a, 'custGeom')
  if (cust) return { kind: 'custom', el: cust }
  return null
}

function fieldTextFor(ctx: SlideContext) {
  return (type: string, cached: string) => {
    if (type === 'slidenum') return String(ctx.number)
    return cached
  }
}

function hasVisibleText(body: TextBody | null): boolean {
  return !!body?.paragraphs.some((p) => p.runs.some((r) => r.kind !== 'br' && r.text.trim() !== ''))
}

function isLinePreset(g: Geometry | null): boolean {
  return (
    g?.kind === 'preset' &&
    (g.name === 'line' ||
      g.name.startsWith('straightConnector') ||
      g.name.startsWith('bentConnector') ||
      g.name.startsWith('curvedConnector'))
  )
}

/** Build one shape (and its children). `part` is the part the element lives in. */
export function buildShape(
  outer: XmlElement,
  ctx: SlideContext,
  origin: ShapeModel['origin'],
  part: string,
  groupFill: Fill | null = null
): ShapeModel | null {
  const el = drawable(outer)
  if (!el) return null
  const kind = shapeKind(el)
  if (!kind) return null
  const id = shapeId(outer) ?? '?'
  const ph = placeholderOf(el)
  const chain = inheritedShapes(ctx, origin, ph)
  const props = propsOf(el)

  // Frame: own, else inherited.
  let box: Xfrm | null = null
  const own = xfrmElement(el)
  if (own && own.child(NS.a, 'off') && own.child(NS.a, 'ext')) box = readXfrm(own)
  for (const inherited of [...chain].reverse()) {
    if (box) break
    const x = xfrmElement(inherited.el)
    if (x && x.child(NS.a, 'off') && x.child(NS.a, 'ext')) box = readXfrm(x)
  }
  if (!box) box = { x: 0, y: 0, cx: 0, cy: 0, rot: 0, flipH: false, flipV: false }

  // Geometry, fill and line: own spPr, else the inherited placeholder's, else the p:style.
  let geometry = geometryOf(props)
  let fill = readFill(fillElement(props), ctx, part)
  let line: Partial<Line> | null = readLine(props?.child(NS.a, 'ln') ?? null, ctx, part)
  for (const inherited of [...chain].reverse()) {
    const ip = propsOf(drawable(inherited.el) as XmlElement)
    geometry = geometry ?? geometryOf(ip)
    fill = fill ?? readFill(fillElement(ip), ctx, inherited.part)
    const il = readLine(ip?.child(NS.a, 'ln') ?? null, ctx, inherited.part)
    if (il) line = { ...il, ...(line ?? {}) }
  }
  const style = el.child(el.ns as string, 'style')
  if (!fill) fill = styleFill(style?.child(NS.a, 'fillRef') ?? null, ctx, part)
  const sl = styleLine(style?.child(NS.a, 'lnRef') ?? null, ctx, part)
  if (sl) line = { ...sl, ...(line ?? {}) }
  if (props?.child(NS.a, 'grpFill') && groupFill) fill = groupFill

  const model: ShapeModel = {
    key: `${origin}:${id}`,
    id,
    name: shapeName(outer),
    origin,
    kind: 'shape',
    box,
    geometry: geometry ?? { kind: 'preset', name: 'rect', adjust: {} },
    fill: fill ?? { kind: 'none' },
    line: null,
    text: null,
    image: null,
    children: [],
    childSpace: null,
    table: null,
    placeholder: ph,
    prompt: null,
    isLine: kind === 'cxnSp' || isLinePreset(geometry),
    el: origin === 'slide' ? outer : null,
  }
  if (line && line.fill && line.fill.kind !== 'none') {
    model.line = {
      fill: line.fill,
      width: line.width ?? 12700,
      dash: line.dash ?? 'solid',
      head: line.head ?? null,
      tail: line.tail ?? null,
    }
  }

  if (kind === 'sp' || kind === 'cxnSp') {
    const body = txBodyOf(el)
    if (body || ph) {
      const sources = textSources(ctx, el, origin, ph)
      // A dsp shape (SmartArt drawing) keeps its text box in dsp:txXfrm; the frame is close enough.
      model.text = buildTextBody(body, sources, ctx, fieldTextFor(ctx))
    }
    if (ph && origin === 'slide' && !hasVisibleText(model.text)) {
      const layoutPh = chain.find((c) => c.part === ctx.layout?.part)?.el
      const custom =
        layoutPh &&
        layoutPh.path([NS.p, 'nvSpPr'], [NS.p, 'nvPr'], [NS.p, 'ph'])?.attr('hasCustomPrompt') ===
          '1'
          ? (txBodyOf(layoutPh)?.textContent() ?? '').trim()
          : ''
      model.prompt = custom || PROMPTS[ph.type] || ''
      if (ph.type === 'dt' || ph.type === 'ftr' || ph.type === 'sldNum') model.prompt = null
    }
  } else if (kind === 'pic') {
    model.kind = 'picture'
    const blipFill = el.child(el.ns as string, 'blipFill')
    const blip = blipFill?.child(NS.a, 'blip')
    const embed = blip?.attrNS(NS.r, 'embed') ?? blip?.attrNS(NS.r, 'link')
    const target = embed ? ctx.deck.pkg.target(part, embed) : null
    const rect = blipFill?.child(NS.a, 'srcRect')
    const c = (k: string) => (Number(rect?.attr(k)) || 0) / 100000
    const ext = target ? target.slice(target.lastIndexOf('.') + 1).toUpperCase() : ''
    model.image = {
      src: target ? ctx.media.src(target) : null,
      crop: { l: c('l'), t: c('t'), r: c('r'), b: c('b') },
      label: target ? `${ext} picture` : 'Linked picture',
    }
    if (!fill) model.fill = { kind: 'none' }
  } else if (kind === 'grpSp') {
    model.kind = 'group'
    const x = xfrmElement(el)
    const xf = x ? readXfrm(x) : null
    model.childSpace =
      xf && xf.chCx !== undefined
        ? { x: xf.chX ?? 0, y: xf.chY ?? 0, cx: xf.chCx || box.cx, cy: xf.chCy || box.cy }
        : { x: box.x, y: box.y, cx: box.cx, cy: box.cy }
    const gf = model.fill.kind === 'none' ? groupFill : model.fill
    for (const child of childShapes(el)) {
      const m = buildShape(child, ctx, origin, part, gf)
      if (m) {
        m.el = null // children are edited through their group in v1
        model.children.push(m)
      }
    }
    model.fill = { kind: 'none' }
    model.line = null
  } else if (kind === 'graphicFrame') {
    buildFrame(model, el, ctx, origin, part)
  } else {
    model.kind = 'unknown'
  }
  return model
}

function buildFrame(
  model: ShapeModel,
  el: XmlElement,
  ctx: SlideContext,
  origin: ShapeModel['origin'],
  part: string
) {
  const data = el.path([NS.a, 'graphic'], [NS.a, 'graphicData'])
  const uri = data?.attr('uri') ?? ''
  model.fill = { kind: 'none' }
  model.line = null
  if (uri.endsWith('/table')) {
    const tbl = data?.child(NS.a, 'tbl')
    if (tbl) {
      model.kind = 'table'
      model.table = buildTable(tbl, ctx, part)
      return
    }
  }
  if (uri.endsWith('/chart')) {
    model.kind = 'chart'
    model.image = { src: null, crop: { l: 0, t: 0, r: 0, b: 0 }, label: 'Chart' }
    return
  }
  if (uri.endsWith('/diagram')) {
    // SmartArt: draw the cached drawing the data part points to.
    const relIds = data?.child(NS.dgm, 'relIds')
    const dm = relIds?.attrNS(NS.r, 'dm')
    const dataPart = dm ? ctx.deck.pkg.target(part, dm) : null
    const dataRoot = dataPart ? ctx.deck.pkg.root(dataPart) : null
    let drawingId: string | null = null
    for (const ext of dataRoot?.descendants(NS.dsp, 'dataModelExt') ?? [])
      drawingId = ext.attr('relId')
    const drawingPart = drawingId ? ctx.deck.pkg.target(part, drawingId) : null
    const drawing = drawingPart ? ctx.deck.pkg.root(drawingPart) : null
    const tree = drawing?.child(NS.dsp, 'spTree')
    if (tree && drawingPart) {
      model.kind = 'group'
      model.childSpace = { x: 0, y: 0, cx: model.box.cx, cy: model.box.cy }
      for (const child of childShapes(tree)) {
        const m = buildShape(child, ctx, origin, drawingPart)
        if (m) {
          m.el = null
          model.children.push(m)
        }
      }
      return
    }
    model.kind = 'object'
    model.image = { src: null, crop: { l: 0, t: 0, r: 0, b: 0 }, label: 'SmartArt' }
    return
  }
  // OLE objects and anything else: the preview picture when the frame carries one.
  const pics = data?.descendants(NS.p, 'pic') ?? []
  const pic = pics[pics.length - 1]
  if (pic) {
    const m = buildShape(pic, ctx, origin, part)
    if (m?.image) {
      model.kind = 'object'
      model.image = m.image
      return
    }
  }
  model.kind = 'object'
  model.image = {
    src: null,
    crop: { l: 0, t: 0, r: 0, b: 0 },
    label: uri.endsWith('/ole') ? 'Embedded object' : 'Object',
  }
}

// ── Tables ───────────────────────────────────────────────────────────────────

function buildTable(tbl: XmlElement, ctx: SlideContext, part: string): TableModel {
  const cols = (tbl.child(NS.a, 'tblGrid')?.childrenOf(NS.a, 'gridCol') ?? []).map(
    (g) => Number(g.attr('w')) || 0
  )
  const tblPr = tbl.child(NS.a, 'tblPr')
  const flag = (k: string) => tblPr?.attr(k) === '1'
  const styleId = tblPr?.child(NS.a, 'tableStyleId')?.textContent().trim() ?? ''
  const styles = ctx.deck.pkg.root('ppt/tableStyles.xml')
  const style =
    styles?.childrenOf(NS.a, 'tblStyle').find((t) => t.attr('styleId') === styleId) ?? null
  const rowsEl = tbl.childrenOf(NS.a, 'tr')
  const nRows = rowsEl.length
  const part0 = (name: string) => style?.child(NS.a, name) ?? null
  const fillOfStyle = (s: XmlElement | null) => {
    const tc = s?.child(NS.a, 'tcStyle')
    const f = tc?.child(NS.a, 'fill')
    const direct = fillElement(f ?? null)
    if (direct) return readFill(direct, ctx, part)
    const ref = tc?.child(NS.a, 'fillRef')
    return ref ? styleFill(ref, ctx, part) : null
  }
  const textOfStyle = (s: XmlElement | null): XmlElement | null =>
    s?.child(NS.a, 'tcTxStyle') ?? null
  const borderOfStyle = (s: XmlElement | null, side: string): Partial<Line> | null => {
    const b = s?.child(NS.a, 'tcStyle')?.child(NS.a, 'tcBdr')?.child(NS.a, side)
    const ln = b?.child(NS.a, 'ln')
    if (ln) return readLine(ln, ctx, part)
    const ref = b?.child(NS.a, 'lnRef')
    return ref ? styleLine(ref, ctx, part) : null
  }

  const rows = rowsEl.map((tr, r) => {
    const cellsEl = tr.childrenOf(NS.a, 'tc')
    const cells = cellsEl.map((tc, c) => {
      const regions: XmlElement[] = []
      const add = (n: string) => {
        const s = part0(n)
        if (s) regions.push(s)
      }
      add('wholeTbl')
      if (
        flag('bandRow') &&
        !(flag('firstRow') && r === 0) &&
        !(flag('lastRow') && r === nRows - 1)
      ) {
        const bandIndex = r - (flag('firstRow') ? 1 : 0)
        add(bandIndex % 2 === 0 ? 'band1H' : 'band2H')
      }
      if (flag('bandCol')) add(c % 2 === 0 ? 'band1V' : 'band2V')
      if (flag('firstCol') && c === 0) add('firstCol')
      if (flag('lastCol') && c === cellsEl.length - 1) add('lastCol')
      if (flag('lastRow') && r === nRows - 1) add('lastRow')
      if (flag('firstRow') && r === 0) add('firstRow')

      let fill: Fill | null = null
      const txStyles: XmlElement[] = []
      const borders: Record<'l' | 'r' | 't' | 'b', Partial<Line> | null> = {
        l: null,
        r: null,
        t: null,
        b: null,
      }
      for (const reg of regions) {
        fill = fillOfStyle(reg) ?? fill
        const tx = textOfStyle(reg)
        if (tx) txStyles.push(tx)
        const sideMap: [keyof typeof borders, string[]][] = [
          ['l', ['left', 'insideV']],
          ['r', ['right', 'insideV']],
          ['t', ['top', 'insideH']],
          ['b', ['bottom', 'insideH']],
        ]
        for (const [k, names] of sideMap) {
          for (const n of names) {
            const b = borderOfStyle(reg, n)
            if (b) borders[k] = b
          }
        }
      }
      const tcPr = tc.child(NS.a, 'tcPr')
      const own = readFill(fillElement(tcPr), ctx, part)
      if (own) fill = own
      const sides: [keyof typeof borders, string][] = [
        ['l', 'lnL'],
        ['r', 'lnR'],
        ['t', 'lnT'],
        ['b', 'lnB'],
      ]
      for (const [k, tag] of sides) {
        const ln = readLine(tcPr?.child(NS.a, tag) ?? null, ctx, part)
        if (ln) borders[k] = { ...(borders[k] ?? {}), ...ln }
      }
      // Cell text: the table style's text colour/weight, then the cell's own runs.
      const sources: TextSources = {
        levels: Array.from({ length: 9 }, () => []),
        bodyPr: [],
        fontRef: null,
        tableText: txStyles,
      }
      const presDefaults =
        ctx.deck.pkg.root(ctx.deck.presPart)?.child(NS.p, 'defaultTextStyle') ?? null
      addListStyle(sources.levels, presDefaults)
      const body = tc.child(NS.a, 'txBody')
      const text = buildTextBody(body, sources, ctx, (_, cached) => cached)
      const m = (k: string, d: number) => {
        const v = tcPr?.attr(k)
        return v !== null && v !== undefined ? Number(v) || 0 : d
      }
      text.insets = {
        l: m('marL', 91440),
        r: m('marR', 91440),
        t: m('marT', 45720),
        b: m('marB', 45720),
      }
      const anchor = tcPr?.attr('anchor')
      text.anchor = anchor === 'ctr' || anchor === 'b' ? anchor : 't'
      const toLine = (p: Partial<Line> | null): Line | null =>
        p && p.fill && p.fill.kind !== 'none'
          ? {
              fill: p.fill,
              width: p.width ?? 12700,
              dash: p.dash ?? 'solid',
              head: null,
              tail: null,
            }
          : null
      return {
        text,
        fill: fill ?? { kind: 'none' },
        borders: {
          l: toLine(borders.l),
          r: toLine(borders.r),
          t: toLine(borders.t),
          b: toLine(borders.b),
        },
        gridSpan: Number(tc.attr('gridSpan')) || 1,
        rowSpan: Number(tc.attr('rowSpan')) || 1,
        merged: tc.attr('hMerge') === '1' || tc.attr('vMerge') === '1',
      } satisfies TableCell
    })
    return { height: Number(tr.attr('h')) || 0, cells }
  })
  return { cols, rows }
}

/** A table style's `a:tcTxStyle`: `b`/`i` as on/off, a colour child, a fontRef. */
function applyTableText(style: RunStyle, tx: XmlElement, ctx: SlideContext): RunStyle {
  const s = { ...style }
  const b = tx.attr('b')
  if (b === 'on') s.bold = true
  else if (b === 'off') s.bold = false
  const i = tx.attr('i')
  if (i === 'on') s.italic = true
  else if (i === 'off') s.italic = false
  const color = resolveColor(colorChild(tx), ctx.colors)
  const fontRef = tx.child(NS.a, 'fontRef')
  const refColor = fontRef ? resolveColor(colorChild(fontRef), ctx.colors) : null
  if (color) s.color = color
  else if (refColor) s.color = refColor
  const idx = fontRef?.attr('idx')
  if (idx === 'major') s.font = ctx.theme.majorFont
  else if (idx === 'minor') s.font = ctx.theme.minorFont
  return s
}

// ── Backgrounds ──────────────────────────────────────────────────────────────

function backgroundOf(root: XmlElement, ctx: SlideContext, part: string): Fill | null {
  const bg = root.path([NS.p, 'cSld'], [NS.p, 'bg'])
  if (!bg) return null
  const bgPr = bg.child(NS.p, 'bgPr')
  if (bgPr) return readFill(fillElement(bgPr), ctx, part)
  const ref = bg.child(NS.p, 'bgRef')
  if (ref) return styleFill(ref, ctx, part)
  return null
}

// ── Slides ───────────────────────────────────────────────────────────────────

const shows = (root: XmlElement) =>
  root.attr('showMasterSp') !== '0' && root.attr('showMasterSp') !== 'false'

/** The whole render model of a slide (or a notes page). */
export function buildSlide(
  deck: Deck,
  slidePart: string,
  number: number,
  media: MediaCache
): SlideModel {
  const ctx = slideContext(deck, slidePart, number, media)
  const size = ctx.notes ? notesSize(deck) : deck.size()
  const background = backgroundOf(ctx.slide.root, ctx, ctx.slide.part) ??
    (ctx.layout ? backgroundOf(ctx.layout.root, ctx, ctx.layout.part) : null) ??
    (ctx.master ? backgroundOf(ctx.master.root, ctx, ctx.master.part) : null) ?? {
      kind: 'solid',
      color: schemeColor('bg1', ctx.colors) ?? { r: 255, g: 255, b: 255, a: 1 },
    }
  const shapes: ShapeModel[] = []
  const nonPlaceholders = (l: Layer, origin: ShapeModel['origin']) => {
    for (const el of l.tree ? childShapes(l.tree) : []) {
      if (placeholderOf(el)) continue
      const m = buildShape(el, ctx, origin, l.part)
      if (m) shapes.push(m)
    }
  }
  const slideShows = shows(ctx.slide.root)
  if (ctx.master && slideShows && (!ctx.layout || shows(ctx.layout.root)) && !ctx.notes)
    nonPlaceholders(ctx.master, 'master')
  if (ctx.layout && slideShows) nonPlaceholders(ctx.layout, 'layout')
  for (const el of ctx.slide.tree ? childShapes(ctx.slide.tree) : []) {
    const m = buildShape(el, ctx, 'slide', ctx.slide.part)
    if (m) shapes.push(m)
  }
  return {
    part: slidePart,
    number,
    size,
    background,
    shapes,
    hidden: ctx.slide.root.attr('show') === '0',
  }
}

function notesSize(deck: Deck): { cx: number; cy: number } {
  const sz = deck.pkg.root(deck.presPart)?.child(NS.p, 'notesSz')
  return { cx: Number(sz?.attr('cx')) || 6858000, cy: Number(sz?.attr('cy')) || 9144000 }
}

/** Find the model of a slide shape by its id (top level only). */
export function findModel(slide: SlideModel, id: string): ShapeModel | null {
  return slide.shapes.find((s) => s.origin === 'slide' && s.id === id) ?? null
}

/** Relationship helper for images inserted by the editor. */
export function imagePartOf(deck: Deck, part: string, embed: string): string | null {
  const rel = deck.pkg.relationships(part).find((r) => r.id === embed)
  if (!rel || rel.external || rel.type !== REL.image) return null
  return resolveTarget(part, rel.target)
}
