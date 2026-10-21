/**
 * The OPC package under a deck: its parts, relationships and content types,
 * patched in place.
 *
 * A part is read as bytes and parsed into an {@link XmlDocument} only when
 * something asks for it. Saving writes, for each part, the bytes it was read
 * with unless an edit changed it; a changed XML part is serialized from its
 * lossless tree, so even inside it only the edited elements differ. Parts the
 * editor never models (charts, embedded objects, custom XML, media) are copied
 * through untouched.
 *
 * Every mutation goes through {@link Package.touch} first, which is what lets
 * a transaction record the parts it changed and undo restore them.
 */
import { NS } from './ns.ts'
import { parseXml, type XmlDocument, type XmlElement, createElement } from './xml.ts'
import { readZip, writeZip, type ZipLimits } from './zip.ts'

export type Relationship = {
  id: string
  type: string
  /** The target as written in the rels part. */
  target: string
  external: boolean
}

/** Bytes per part, null where a part is absent: what undo and redo restore. */
export type PartStates = Map<string, { name: string; bytes: Uint8Array | null }>

export type Change = { before: PartStates; after: PartStates }

type Encoding = { bom: boolean; utf16: false | 'le' | 'be' }

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const CONTENT_TYPES = '[Content_Types].xml'

const key = (name: string) => name.replace(/^\//, '').toLowerCase()

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function decodePart(bytes: Uint8Array): { text: string; encoding: Encoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder().decode(bytes.subarray(3)),
      encoding: { bom: true, utf16: false },
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: { bom: false, utf16: 'le' },
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: { bom: false, utf16: 'be' },
    }
  }
  return { text: new TextDecoder().decode(bytes), encoding: { bom: false, utf16: false } }
}

function encodePart(text: string, encoding: Encoding): Uint8Array {
  // A UTF-16 part is written back as UTF-8, its declaration saying so.
  const body = encoding.utf16
    ? text.replace(/^(<\?xml[^>]*encoding=)(["'])utf-16\2/i, '$1$2UTF-8$2')
    : text
  const utf8 = new TextEncoder().encode(body)
  if (!encoding.bom) return utf8
  const out = new Uint8Array(utf8.length + 3)
  out.set([0xef, 0xbb, 0xbf])
  out.set(utf8, 3)
  return out
}

/** The directory a part lives in, without a trailing slash ('' at the root). */
export function partDir(part: string): string {
  const i = part.lastIndexOf('/')
  return i < 0 ? '' : part.slice(0, i)
}

/** The rels part that describes `part` ('' is the package itself). */
export function relsPartOf(part: string): string {
  if (part === '') return '_rels/.rels'
  const dir = partDir(part)
  const file = part.slice(dir.length ? dir.length + 1 : 0)
  return `${dir ? `${dir}/` : ''}_rels/${file}.rels`
}

/** Resolve a rels Target written in `fromPart`'s rels to a part name. */
export function resolveTarget(fromPart: string, target: string): string {
  const clean = target.split('#')[0]
  if (clean.startsWith('/')) return normalizePath(clean.slice(1))
  const base = partDir(fromPart)
  return normalizePath(base ? `${base}/${clean}` : clean)
}

function normalizePath(path: string): string {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(decodeURIComponentSafe(seg))
  }
  return out.join('/')
}

function decodeURIComponentSafe(s: string): string {
  if (!s.includes('%')) return s
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** The relative Target that reaches `toPart` from `fromPart`'s rels. */
export function relativeTarget(fromPart: string, toPart: string): string {
  const from = partDir(fromPart).split('/').filter(Boolean)
  const to = toPart.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const up = from.slice(common).map(() => '..')
  return [...up, ...to.slice(common)].join('/')
}

export class Package {
  /** Key → the part name as the package spells it. */
  private names = new Map<string, string>()
  /** Keys in the package's order; new parts are appended. */
  private order: string[] = []
  private original = new Map<string, Uint8Array>()
  /** Parts written since opening (bytes) or removed (null). */
  private written = new Map<string, Uint8Array | null>()
  private docs = new Map<string, { doc: XmlDocument; encoding: Encoding }>()
  /** Every name the package has ever had, so a new part never reuses a deleted one's. */
  private everUsed = new Set<string>()
  private tx: PartStates | null = null
  /** Bumped whenever a part may have changed: render caches key on it. */
  private revisions = new Map<string, number>()
  private bump(k: string): void {
    this.revisions.set(k, (this.revisions.get(k) ?? 0) + 1)
  }

  /** A number that changes whenever `name` may have changed. */
  revision(name: string): number {
    return this.revisions.get(key(name)) ?? 0
  }

  static open(bytes: Uint8Array, limits?: ZipLimits): Package {
    const pkg = new Package()
    const { names, files } = readZip(bytes, limits)
    for (const name of names) {
      const k = key(name)
      if (pkg.names.has(k)) continue
      pkg.names.set(k, name)
      pkg.order.push(k)
      pkg.original.set(k, files.get(name) as Uint8Array)
      pkg.everUsed.add(k)
    }
    return pkg
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  has(name: string): boolean {
    const k = key(name)
    if (this.written.has(k)) return this.written.get(k) !== null
    return this.original.has(k)
  }

  /** The part's current bytes, or null when it does not exist. */
  bytes(name: string): Uint8Array | null {
    const k = key(name)
    const parsed = this.docs.get(k)
    if (parsed && parsed.doc.changed) return encodePart(parsed.doc.serialize(), parsed.encoding)
    if (this.written.has(k)) return this.written.get(k) ?? null
    return this.original.get(k) ?? null
  }

  /** The bytes the part had when the package was opened, or null for a new part. */
  originalBytes(name: string): Uint8Array | null {
    return this.original.get(key(name)) ?? null
  }

  /** The part parsed (cached). Null when it does not exist. Throws on malformed XML. */
  xml(name: string): XmlDocument | null {
    const k = key(name)
    const cached = this.docs.get(k)
    if (cached) return cached.doc
    const bytes = this.bytes(name)
    if (!bytes) return null
    const { text, encoding } = decodePart(bytes)
    const doc = parseXml(text)
    this.docs.set(k, { doc, encoding })
    return doc
  }

  /** The part's root element, or null. */
  root(name: string): XmlElement | null {
    return this.xml(name)?.root ?? null
  }

  /** The part's root, recorded in the running transaction first: for parts about to change. */
  rootForEdit(name: string): XmlElement {
    this.touch(name)
    const root = this.root(name)
    if (!root) throw new Error(`${name} is not in the package`)
    return root
  }

  /** Every part name, in package order. */
  partNames(): string[] {
    return this.order.filter((k) => this.has(k)).map((k) => this.names.get(k) as string)
  }

  /** The spelling of `name` the package uses, or `name` when it has no such part. */
  canonical(name: string): string {
    return this.names.get(key(name)) ?? name.replace(/^\//, '')
  }

  // ── Writing ────────────────────────────────────────────────────────────────

  /** Record `name`'s current state in the running transaction (once per transaction). */
  touch(name: string): void {
    const k = key(name)
    this.bump(k)
    if (!this.tx || this.tx.has(k)) return
    this.tx.set(k, { name: this.canonical(name), bytes: this.bytes(name) })
  }

  /** Write a part's bytes (a new part, or new content for one). */
  write(name: string, bytes: Uint8Array): void {
    this.touch(name)
    const k = key(name)
    if (!this.names.has(k)) {
      this.names.set(k, name.replace(/^\//, ''))
      this.order.push(k)
    }
    this.everUsed.add(k)
    this.docs.delete(k)
    this.written.set(k, bytes)
    this.bump(k)
  }

  /** Write a new XML part from text (an XML declaration is added when missing). */
  writeXml(name: string, xml: string): void {
    const text = xml.startsWith('<?xml') ? xml : XML_DECL + xml
    this.write(name, new TextEncoder().encode(text))
  }

  remove(name: string): void {
    if (!this.has(name)) return
    this.touch(name)
    const k = key(name)
    this.docs.delete(k)
    this.written.set(k, null)
    this.bump(k)
  }

  /** The first `pattern` (with `{n}` for a number) whose name was never used. */
  freeName(pattern: string, start = 1): string {
    for (let n = start; ; n++) {
      const name = pattern.replace('{n}', String(n))
      if (!this.everUsed.has(key(name))) return name
    }
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  begin(): void {
    this.tx = new Map()
  }

  get inTransaction(): boolean {
    return this.tx !== null
  }

  /** End the transaction: what changed, or null when nothing did. */
  commit(): Change | null {
    const before = this.tx
    this.tx = null
    if (!before) return null
    const after: PartStates = new Map()
    for (const [k, state] of before) {
      this.bump(k)
      const now = this.bytes(k)
      const same =
        now === null || state.bytes === null ? now === state.bytes : bytesEqual(now, state.bytes)
      if (same) before.delete(k)
      else after.set(k, { name: state.name, bytes: now })
    }
    return before.size === 0 ? null : { before, after }
  }

  /** Throw away the running transaction's changes. */
  rollback(): void {
    const before = this.tx
    this.tx = null
    if (before) this.restore(before)
  }

  /** Put parts back into the given states (undo / redo). */
  restore(states: PartStates): void {
    for (const [k, state] of states) {
      this.docs.delete(k)
      this.bump(k)
      if (state.bytes === null) {
        this.written.set(k, null)
        continue
      }
      if (!this.names.has(k)) {
        this.names.set(k, state.name)
        this.order.push(k)
      }
      this.everUsed.add(k)
      const orig = this.original.get(k)
      if (orig && bytesEqual(orig, state.bytes)) this.written.delete(k)
      else this.written.set(k, state.bytes)
    }
  }

  // ── Relationships ──────────────────────────────────────────────────────────

  relationships(part: string): Relationship[] {
    const root = this.root(relsPartOf(part))
    if (!root) return []
    return root.childrenOf(NS.rels, 'Relationship').map((el) => ({
      id: el.attr('Id') ?? '',
      type: el.attr('Type') ?? '',
      target: el.attr('Target') ?? '',
      external: el.attr('TargetMode') === 'External',
    }))
  }

  /** The part a relationship of `part` points at (null for external or missing ones). */
  target(part: string, id: string): string | null {
    const rel = this.relationships(part).find((r) => r.id === id)
    if (!rel || rel.external) return null
    return this.canonical(resolveTarget(part, rel.target))
  }

  /** The first internal relationship of `type`, resolved. */
  targetOfType(part: string, type: string): string | null {
    const rel = this.relationships(part).find((r) => r.type === type && !r.external)
    return rel ? this.canonical(resolveTarget(part, rel.target)) : null
  }

  private relsRootForEdit(part: string): XmlElement {
    const relsName = relsPartOf(part)
    if (!this.has(relsName)) {
      this.writeXml(relsName, `${XML_DECL}<Relationships xmlns="${NS.rels}"></Relationships>`)
    }
    return this.rootForEdit(relsName)
  }

  /** Add a relationship from `part` to `toPart` (or an external URL); returns its id. */
  addRelationship(part: string, type: string, toPart: string, external = false): string {
    const root = this.relsRootForEdit(part)
    const used = new Set(root.childrenOf(NS.rels, 'Relationship').map((r) => r.attr('Id')))
    let n = used.size + 1
    for (const id of used) {
      const m = /^rId(\d+)$/.exec(id ?? '')
      if (m) n = Math.max(n, Number(m[1]) + 1)
    }
    while (used.has(`rId${n}`)) n++
    const id = `rId${n}`
    const attrs: Record<string, string> = {
      Id: id,
      Type: type,
      Target: external ? toPart : relativeTarget(part, toPart),
    }
    if (external) attrs.TargetMode = 'External'
    root.append(createElement(root, NS.rels, 'Relationship', '', attrs))
    return id
  }

  removeRelationship(part: string, id: string): void {
    const relsName = relsPartOf(part)
    if (!this.has(relsName)) return
    const root = this.rootForEdit(relsName)
    for (const el of root.childrenOf(NS.rels, 'Relationship')) {
      if (el.attr('Id') === id) el.remove()
    }
  }

  // ── Content types ──────────────────────────────────────────────────────────

  contentType(part: string): string | null {
    const root = this.root(CONTENT_TYPES)
    if (!root) return null
    const want = `/${key(part)}`
    for (const o of root.childrenOf(NS.ct, 'Override')) {
      if ((o.attr('PartName') ?? '').toLowerCase() === want) return o.attr('ContentType')
    }
    const dot = part.lastIndexOf('.')
    const ext = dot < 0 ? '' : part.slice(dot + 1).toLowerCase()
    for (const d of root.childrenOf(NS.ct, 'Default')) {
      if ((d.attr('Extension') ?? '').toLowerCase() === ext) return d.attr('ContentType')
    }
    return null
  }

  setOverride(part: string, contentType: string): void {
    const root = this.rootForEdit(CONTENT_TYPES)
    const want = `/${key(part)}`
    for (const o of root.childrenOf(NS.ct, 'Override')) {
      if ((o.attr('PartName') ?? '').toLowerCase() === want) {
        o.setAttr('ContentType', contentType)
        return
      }
    }
    root.append(
      createElement(root, NS.ct, 'Override', '', {
        PartName: `/${part.replace(/^\//, '')}`,
        ContentType: contentType,
      })
    )
  }

  removeOverride(part: string): void {
    const root = this.root(CONTENT_TYPES)
    if (!root) return
    const want = `/${key(part)}`
    const hits = root
      .childrenOf(NS.ct, 'Override')
      .filter((o) => (o.attr('PartName') ?? '').toLowerCase() === want)
    if (hits.length === 0) return
    this.touch(CONTENT_TYPES)
    for (const o of hits) o.remove()
  }

  ensureDefault(extension: string, contentType: string): void {
    const root = this.root(CONTENT_TYPES)
    if (!root) return
    const ext = extension.toLowerCase()
    if (
      root
        .childrenOf(NS.ct, 'Default')
        .some((d) => (d.attr('Extension') ?? '').toLowerCase() === ext)
    ) {
      return
    }
    this.touch(CONTENT_TYPES)
    // Defaults come before Overrides in the schema.
    const firstOverride = root.child(NS.ct, 'Override')
    const el = createElement(root, NS.ct, 'Default', '', {
      Extension: ext,
      ContentType: contentType,
    })
    if (firstOverride) root.insertBefore(el, firstOverride)
    else root.append(el)
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  /** Every present part with its bytes, in package order. */
  entries(): [string, Uint8Array][] {
    const out: [string, Uint8Array][] = []
    for (const k of this.order) {
      const bytes = this.bytes(k)
      if (bytes) out.push([this.names.get(k) as string, bytes])
    }
    return out
  }

  /** The package as a .pptx file. */
  save(): Uint8Array {
    return writeZip(this.entries())
  }
}
