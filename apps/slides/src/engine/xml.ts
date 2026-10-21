/**
 * A lossless XML tree for the parts of a package the editor touches.
 *
 * Every node remembers the slice of source it was parsed from. Serializing a
 * node nobody changed writes that slice back verbatim, so an edit to one shape
 * leaves the rest of its slide (animations, transitions, `mc:AlternateContent`,
 * extension lists, whitespace, attribute quoting) byte for byte as it was. Only
 * an element whose own attributes or child list changed is written out from
 * its structure, and even then its untouched children are copied from source.
 *
 * The same code runs in the browser, in a worker and in node tests, which a
 * DOMParser/XMLSerializer pair would not give (no DOM in a worker, and jsdom's
 * serializer is not Chrome's).
 *
 * Deliberately small: no DTDs (a DOCTYPE is kept as text and never expanded),
 * no entity definitions beyond the five predefined ones and character
 * references. OOXML parts use neither.
 */

export type XmlAttr = {
  /** The qualified name as written, `r:id`, `xmlns:a`, `type`. */
  name: string
  /** The value as written between the quotes, still escaped. */
  raw: string
  quote: '"' | "'"
}

/** Comments, processing instructions, CDATA and DOCTYPE: kept verbatim, never interpreted. */
export class XmlOther {
  readonly kind = 'other'
  parent: XmlElement | null = null
  readonly raw: string
  constructor(raw: string) {
    this.raw = raw
  }
  serialize(): string {
    return this.raw
  }
}

export class XmlText {
  readonly kind = 'text'
  parent: XmlElement | null = null
  private rawText: string
  constructor(rawText: string) {
    this.rawText = rawText
  }
  /** The text as written, still escaped. */
  get raw(): string {
    return this.rawText
  }
  /** The decoded text. */
  get text(): string {
    return decodeXml(this.rawText)
  }
  set text(value: string) {
    this.rawText = escapeText(value)
    this.parent?.touch()
  }
  serialize(): string {
    return this.rawText
  }
}

export type XmlNode = XmlElement | XmlText | XmlOther

type Source = { text: string; start: number; openEnd: number; end: number; selfClosing: boolean }

export class XmlElement {
  readonly kind = 'element'
  parent: XmlElement | null = null
  attrs: XmlAttr[]
  children: XmlNode[] = []
  /** Where this element came from, while its own start tag still matches. */
  private source: Source | null
  /** True when the start tag must be rebuilt from `attrs`. */
  private attrsChanged = false
  /** True when anything in this subtree changed since it was parsed. */
  private dirty = false
  private nsCache: string | null | undefined = undefined
  name: string
  /**
   * Where a detached element will go (set by createElement and clone): its
   * prefixes resolve through there until it is inserted, so building a
   * subtree before attaching it does not declare namespaces it will inherit.
   */
  scopeHint: XmlElement | null = null

  constructor(name: string, attrs: XmlAttr[] = [], source: Source | null = null) {
    this.name = name
    this.attrs = attrs
    this.source = source
    if (!source) this.dirty = true
  }

  get prefix(): string {
    const colon = this.name.indexOf(':')
    return colon < 0 ? '' : this.name.slice(0, colon)
  }

  get local(): string {
    const colon = this.name.indexOf(':')
    return colon < 0 ? this.name : this.name.slice(colon + 1)
  }

  /** The namespace URI of this element's name. */
  get ns(): string | null {
    if (this.nsCache === undefined) this.nsCache = this.lookupNamespace(this.prefix)
    return this.nsCache
  }

  /** True when this element is `{ns}local`. */
  is(ns: string, local: string): boolean {
    return this.local === local && this.ns === ns
  }

  /** The URI bound to `prefix` here ('' is the default namespace). */
  lookupNamespace(prefix: string): string | null {
    if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace'
    const decl = prefix === '' ? 'xmlns' : `xmlns:${prefix}`
    for (const el of this.selfAndAncestors()) {
      const a = el.attrs.find((x) => x.name === decl)
      if (a) return decodeXml(a.raw) || null
    }
    return null
  }

  /** This element, then each parent up to the root (and on through the root's scope hint). */
  selfAndAncestors(): XmlElement[] {
    const out: XmlElement[] = [this]
    const seen = new Set<XmlElement>([this])
    for (let p = this.parent ?? this.scopeHint; p && !seen.has(p); p = p.parent ?? p.scopeHint) {
      seen.add(p)
      out.push(p)
    }
    return out
  }

  /** A prefix bound to `uri` in scope here (and not shadowed), or null. */
  lookupPrefix(uri: string): string | null {
    for (const el of this.selfAndAncestors()) {
      for (const a of el.attrs) {
        if (a.name !== 'xmlns' && !a.name.startsWith('xmlns:')) continue
        if (decodeXml(a.raw) !== uri) continue
        const p = a.name === 'xmlns' ? '' : a.name.slice(6)
        if (this.lookupNamespace(p) === uri) return p
      }
    }
    return null
  }

  /** The parser's hook: where this element's end tag finishes. */
  closeSource(end: number): void {
    if (this.source) this.source.end = end
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** Child elements, in order. */
  elements(): XmlElement[] {
    const out: XmlElement[] = []
    for (const c of this.children) if (c.kind === 'element') out.push(c)
    return out
  }

  /** The first child element `{ns}local`. */
  child(ns: string, local: string): XmlElement | null {
    for (const c of this.children) if (c.kind === 'element' && c.is(ns, local)) return c
    return null
  }

  /** Every child element `{ns}local`. */
  childrenOf(ns: string, local: string): XmlElement[] {
    const out: XmlElement[] = []
    for (const c of this.children) if (c.kind === 'element' && c.is(ns, local)) out.push(c)
    return out
  }

  /** Follow a path of `[ns, local]` steps through first matching children. */
  path(...steps: [string, string][]): XmlElement | null {
    if (steps.length === 0) return this
    const [[ns, local], ...rest] = steps
    return this.child(ns, local)?.path(...rest) ?? null
  }

  /** Every descendant element `{ns}local`, depth first. */
  descendants(ns: string, local: string, out: XmlElement[] = []): XmlElement[] {
    for (const c of this.children) {
      if (c.kind !== 'element') continue
      if (c.is(ns, local)) out.push(c)
      c.descendants(ns, local, out)
    }
    return out
  }

  /** The decoded value of the unprefixed attribute `name`, or null. */
  attr(name: string): string | null {
    const a = this.attrs.find((x) => x.name === name)
    return a ? decodeXml(a.raw) : null
  }

  /** The decoded value of the attribute `{ns}local`, or null. */
  attrNS(ns: string, local: string): string | null {
    for (const a of this.attrs) {
      const colon = a.name.indexOf(':')
      if (colon < 0) continue
      const prefix = a.name.slice(0, colon)
      if (prefix === 'xmlns') continue
      if (a.name.slice(colon + 1) === local && this.lookupNamespace(prefix) === ns) {
        return decodeXml(a.raw)
      }
    }
    return null
  }

  /** The decoded text of every descendant text node. */
  textContent(): string {
    let s = ''
    for (const c of this.children) {
      if (c.kind === 'text') s += c.text
      else if (c.kind === 'element') s += c.textContent()
      else if (c.raw.startsWith('<![CDATA[')) s += c.raw.slice(9, -3)
    }
    return s
  }

  // ── Writing ────────────────────────────────────────────────────────────────

  /**
   * Mark this subtree changed, up to the root. A changed element always has
   * changed ancestors (insert() touches the new parent), so the walk can stop
   * at the first one already marked.
   */
  touch(): void {
    if (this.dirty) return
    this.dirty = true
    this.parent?.touch()
  }

  /** True when this subtree changed since it was parsed (or it was never parsed). */
  get changed(): boolean {
    return this.dirty
  }

  setAttr(name: string, value: string): void {
    const raw = escapeAttr(value, '"')
    const a = this.attrs.find((x) => x.name === name)
    if (a) {
      if (decodeXml(a.raw) === value) return
      a.raw = a.quote === '"' ? raw : escapeAttr(value, "'")
    } else {
      this.attrs.push({ name, raw, quote: '"' })
    }
    if (name === 'xmlns' || name.startsWith('xmlns:')) this.clearNsCache()
    this.attrsChanged = true
    this.touch()
  }

  /** Change the element's qualified name (its start tag is rebuilt). */
  rename(name: string): void {
    if (name === this.name) return
    this.name = name
    this.nsCache = undefined
    this.attrsChanged = true
    this.touch()
  }

  removeAttr(name: string): void {
    const i = this.attrs.findIndex((x) => x.name === name)
    if (i < 0) return
    this.attrs.splice(i, 1)
    this.attrsChanged = true
    this.touch()
  }

  /** Insert `node` at `index` (default: the end), detaching it from where it was. */
  insert(node: XmlNode, index = this.children.length): void {
    if (node.parent) node.parent.removeChild(node)
    node.parent = this
    if (node.kind === 'element') node.clearNsCache()
    this.children.splice(Math.max(0, Math.min(index, this.children.length)), 0, node)
    this.touch()
  }

  append(node: XmlNode): void {
    this.insert(node)
  }

  /** Insert `node` right after `ref`, one of this element's children. */
  insertAfter(node: XmlNode, ref: XmlNode): void {
    // Detach first: moving a node within this element shifts `ref`'s index.
    if (node.parent) node.parent.removeChild(node)
    const i = this.children.indexOf(ref)
    this.insert(node, i < 0 ? this.children.length : i + 1)
  }

  insertBefore(node: XmlNode, ref: XmlNode): void {
    if (node.parent) node.parent.removeChild(node)
    const i = this.children.indexOf(ref)
    this.insert(node, i < 0 ? this.children.length : i)
  }

  removeChild(node: XmlNode): void {
    const i = this.children.indexOf(node)
    if (i < 0) return
    this.children.splice(i, 1)
    node.parent = null
    this.touch()
  }

  /** Detach this element from its parent. */
  remove(): void {
    this.parent?.removeChild(this)
  }

  /** Replace every child with `nodes`. */
  replaceChildren(nodes: XmlNode[]): void {
    for (const c of this.children) c.parent = null
    this.children = []
    for (const n of nodes) {
      if (n.parent) n.parent.removeChild(n)
      n.parent = this
      if (n.kind === 'element') n.clearNsCache()
      this.children.push(n)
    }
    this.touch()
  }

  /** Set the element's whole content to one text node. */
  setText(value: string): void {
    this.replaceChildren(value === '' ? [] : [new XmlText(escapeText(value))])
  }

  /**
   * A deep copy. It keeps the source slices, so an untouched copy serializes
   * exactly like the original (prefixes and all): put it where the same
   * prefixes are bound, or use {@link importInto}.
   */
  clone(): XmlElement {
    const copy = new XmlElement(
      this.name,
      this.attrs.map((a) => ({ ...a })),
      this.source
    )
    copy.attrsChanged = this.attrsChanged
    copy.dirty = this.dirty
    copy.scopeHint = this.parent ?? this.scopeHint
    for (const c of this.children) {
      const child =
        c.kind === 'element'
          ? c.clone()
          : c.kind === 'text'
            ? new XmlText(c.raw)
            : new XmlOther(c.raw)
      child.parent = copy
      copy.children.push(child)
    }
    return copy
  }

  private clearNsCache(): void {
    this.nsCache = undefined
    for (const c of this.children) if (c.kind === 'element') c.clearNsCache()
  }

  serialize(): string {
    const src = this.source
    if (src && !this.dirty) return src.text.slice(src.start, src.end)
    const reuseStart = src && !this.attrsChanged && !(src.selfClosing && this.children.length > 0)
    let out: string
    if (reuseStart) {
      const startTag = src.text.slice(src.start, src.openEnd)
      if (src.selfClosing) return startTag // no children, attributes unchanged
      out = startTag
    } else {
      out = `<${this.name}`
      for (const a of this.attrs) out += ` ${a.name}=${a.quote}${a.raw}${a.quote}`
      if (this.children.length === 0) return `${out}/>`
      out += '>'
    }
    for (const c of this.children) out += c.serialize()
    return `${out}</${this.name}>`
  }
}

/** A parsed part: what comes before the root (the XML declaration), the root, and after. */
export class XmlDocument {
  readonly prolog: XmlNode[]
  readonly root: XmlElement
  readonly epilog: XmlNode[]
  private readonly sourceText: string

  constructor(prolog: XmlNode[], root: XmlElement, epilog: XmlNode[], sourceText: string) {
    this.prolog = prolog
    this.root = root
    this.epilog = epilog
    this.sourceText = sourceText
  }

  get changed(): boolean {
    return this.root.changed
  }

  serialize(): string {
    if (!this.root.changed) return this.sourceText
    return (
      this.prolog.map((n) => n.serialize()).join('') +
      this.root.serialize() +
      this.epilog.map((n) => n.serialize()).join('')
    )
  }
}

export class XmlParseError extends Error {
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`)
    this.name = 'XmlParseError'
  }
}

const NAME_END = /[\s/>=]/

/** Parse a whole part. Throws {@link XmlParseError} on markup that is not well formed. */
export function parseXml(text: string): XmlDocument {
  const n = text.length
  const stack: XmlElement[] = []
  const prolog: XmlNode[] = []
  const epilog: XmlNode[] = []
  let root: XmlElement | null = null
  let i = 0

  const place = (node: XmlNode) => {
    const parent = stack[stack.length - 1]
    if (parent) {
      node.parent = parent
      parent.children.push(node)
    } else if (node.kind === 'element') {
      if (root) throw new XmlParseError('a second root element', i)
      root = node
    } else {
      if (node.kind === 'text' && node.raw.trim() !== '') {
        throw new XmlParseError('text outside the root element', i)
      }
      ;(root ? epilog : prolog).push(node)
    }
  }

  const findOrThrow = (needle: string, from: number, what: string) => {
    const at = text.indexOf(needle, from)
    if (at < 0) throw new XmlParseError(`unterminated ${what}`, from)
    return at
  }

  while (i < n) {
    const lt = text.indexOf('<', i)
    if (lt < 0) {
      place(new XmlText(text.slice(i)))
      break
    }
    if (lt > i) place(new XmlText(text.slice(i, lt)))
    i = lt
    if (text.startsWith('<!--', i)) {
      const end = findOrThrow('-->', i + 4, 'comment') + 3
      place(new XmlOther(text.slice(i, end)))
      i = end
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = findOrThrow(']]>', i + 9, 'CDATA section') + 3
      place(new XmlOther(text.slice(i, end)))
      i = end
    } else if (text.startsWith('<?', i)) {
      const end = findOrThrow('?>', i + 2, 'processing instruction') + 2
      place(new XmlOther(text.slice(i, end)))
      i = end
    } else if (text.startsWith('<!', i)) {
      // A DOCTYPE, possibly with an internal subset in brackets. Kept, never expanded.
      let j = i + 2
      let depth = 0
      while (j < n && (text[j] !== '>' || depth > 0)) {
        if (text[j] === '[') depth++
        else if (text[j] === ']') depth--
        j++
      }
      if (j >= n) throw new XmlParseError('unterminated declaration', i)
      place(new XmlOther(text.slice(i, j + 1)))
      i = j + 1
    } else if (text[i + 1] === '/') {
      const close = findOrThrow('>', i, 'end tag')
      const name = text.slice(i + 2, close).trim()
      const open = stack.pop()
      if (!open || open.name !== name) {
        throw new XmlParseError(`</${name}> does not close <${open?.name ?? '(nothing)'}>`, i)
      }
      open.closeSource(close + 1)
      i = close + 1
    } else {
      // Start tag.
      let j = i + 1
      while (j < n && !NAME_END.test(text[j])) j++
      const name = text.slice(i + 1, j)
      if (name === '') throw new XmlParseError('an element with no name', i)
      const attrs: XmlAttr[] = []
      let selfClosing = false
      for (;;) {
        while (j < n && /\s/.test(text[j])) j++
        if (j >= n) throw new XmlParseError(`unterminated <${name}>`, i)
        if (text[j] === '>') {
          j++
          break
        }
        if (text[j] === '/' && text[j + 1] === '>') {
          selfClosing = true
          j += 2
          break
        }
        const nameStart = j
        while (j < n && !NAME_END.test(text[j])) j++
        const attrName = text.slice(nameStart, j)
        while (j < n && /\s/.test(text[j])) j++
        if (attrName === '' || text[j] !== '=') {
          throw new XmlParseError(`a malformed attribute in <${name}>`, j)
        }
        j++
        while (j < n && /\s/.test(text[j])) j++
        const quote = text[j]
        if (quote !== '"' && quote !== "'") {
          throw new XmlParseError(`an unquoted attribute in <${name}>`, j)
        }
        const close = text.indexOf(quote, j + 1)
        if (close < 0) throw new XmlParseError(`an unterminated attribute in <${name}>`, j)
        attrs.push({ name: attrName, raw: text.slice(j + 1, close), quote })
        j = close + 1
      }
      const el = new XmlElement(name, attrs, {
        text,
        start: i,
        openEnd: j,
        end: j,
        selfClosing,
      })
      place(el)
      if (!selfClosing) stack.push(el)
      i = j
    }
  }
  if (stack.length > 0)
    throw new XmlParseError(`<${stack[stack.length - 1].name}> is never closed`, n)
  if (!root) throw new XmlParseError('no root element', 0)
  return new XmlDocument(prolog, root, epilog, text)
}

// ── Escaping ─────────────────────────────────────────────────────────────────

const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g

export function decodeXml(raw: string): string {
  if (raw.indexOf('&') < 0) return raw
  return raw.replace(ENTITY, (whole, body: string) => {
    switch (body) {
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'amp':
        return '&'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
    }
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : whole
  })
}

/**
 * Characters XML 1.0 cannot carry at all (most C0 controls, lone surrogates,
 * U+FFFE/U+FFFF). Typed or pasted text may hold them; they are dropped.
 */
const NOT_XML = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]',
  'g'
)

export function escapeText(value: string): string {
  return value
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function escapeAttr(value: string, quote: '"' | "'"): string {
  let s = value
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
  s = quote === '"' ? s.replace(/"/g, '&quot;') : s.replace(/'/g, '&apos;')
  return s
}

// ── Building ─────────────────────────────────────────────────────────────────

/**
 * A new element `{ns}local` for a place under `scope`, using the prefix that
 * is bound to `ns` there. When none is, `fallbackPrefix` is declared on the
 * new element itself.
 */
export function createElement(
  scope: XmlElement,
  ns: string,
  local: string,
  fallbackPrefix: string,
  attrs: Record<string, string> = {}
): XmlElement {
  const bound = scope.lookupPrefix(ns)
  const prefix = bound ?? fallbackPrefix
  const el = new XmlElement(prefix ? `${prefix}:${local}` : local)
  el.scopeHint = scope
  if (bound === null) {
    el.attrs.push({
      name: prefix ? `xmlns:${prefix}` : 'xmlns',
      raw: escapeAttr(ns, '"'),
      quote: '"',
    })
  }
  for (const [k, v] of Object.entries(attrs)) {
    el.attrs.push({ name: k, raw: escapeAttr(v, '"'), quote: '"' })
  }
  return el
}

/**
 * Parse a fragment written with the given prefix bindings, for building new
 * shapes from a template. `bindings` maps prefix → URI; they are declared on a
 * wrapper that is dropped, so the returned element is detached and relies on
 * the place it is inserted to bind the same prefixes (call {@link importInto}).
 */
export function parseFragment(xml: string, bindings: Record<string, string>): XmlElement {
  const decls = Object.entries(bindings)
    .map(([p, uri]) => ` xmlns:${p}="${escapeAttr(uri, '"')}"`)
    .join('')
  const doc = parseXml(`<wrap${decls}>${xml}</wrap>`)
  const el = doc.root.elements()[0]
  if (!el) throw new XmlParseError('an empty fragment', 0)
  // Carry the bindings so importInto can declare what the target lacks.
  const copy = el.clone()
  ;(copy as unknown as { fragmentBindings: Record<string, string> }).fragmentBindings = bindings
  return copy
}

/**
 * Make `el` (a detached element parsed or copied from elsewhere) safe to put
 * under `target`: every prefix it uses that `target` does not bind to the same
 * URI is declared on `el` itself. `sourceScope` is where `el` came from (an
 * element of the other document); fragments carry their own bindings.
 */
export function importInto(
  el: XmlElement,
  target: XmlElement,
  sourceScope?: XmlElement | null
): XmlElement {
  const bindings = (el as unknown as { fragmentBindings?: Record<string, string> }).fragmentBindings
  const used = new Set<string>()
  const collect = (e: XmlElement) => {
    used.add(e.prefix)
    for (const a of e.attrs) {
      const colon = a.name.indexOf(':')
      if (colon > 0 && !a.name.startsWith('xmlns')) used.add(a.name.slice(0, colon))
    }
    for (const c of e.children) if (c.kind === 'element') collect(c)
  }
  collect(el)
  for (const prefix of used) {
    if (prefix === 'xml') continue
    const decl = prefix === '' ? 'xmlns' : `xmlns:${prefix}`
    if (el.attrs.some((a) => a.name === decl)) continue
    const uri =
      bindings?.[prefix] ??
      sourceScope?.lookupNamespace(prefix) ??
      (prefix === '' ? null : undefined)
    if (uri === undefined || uri === null) continue
    if (target.lookupNamespace(prefix) === uri) continue
    el.setAttr(decl, uri)
  }
  return el
}
