/**
 * The zip layer of a package. fflate's synchronous API only: its async API
 * spawns `blob:` workers, which the desktop's CSP refuses (the OS's Docs hung
 * on that once).
 *
 * A deck is untrusted input, so the central directory is read first and the
 * package refused before anything is inflated if it claims more entries or
 * more bytes than a presentation reasonably holds (a zip bomb would otherwise
 * take the whole desktop tab with it).
 */
import { unzipSync, zipSync } from 'fflate'

export type ZipLimits = {
  /** Most entries a package may have. */
  maxEntries: number
  /** Most bytes all entries may inflate to, together. */
  maxTotalBytes: number
}

export const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxTotalBytes: 1024 * 1024 * 1024,
}

export class NotAZipError extends Error {
  constructor(message = 'This file is not a zip package.') {
    super(message)
    this.name = 'NotAZipError'
  }
}

export class PackageTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackageTooLargeError'
  }
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50

/** Entry names in central-directory order, after checking the sizes it declares. */
export function listEntries(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const len = bytes.length
  if (len < 22) throw new NotAZipError()
  // The end record sits in the last 22 bytes plus a comment of up to 64 KiB.
  let eocd = -1
  for (let i = len - 22; i >= Math.max(0, len - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new NotAZipError()
  const count = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new PackageTooLargeError('This presentation is a ZIP64 package, too large to open here.')
  }
  if (count > limits.maxEntries) {
    throw new PackageTooLargeError(
      `This presentation has ${count} parts, more than this app opens.`
    )
  }
  if (cdOffset + cdSize > len) throw new NotAZipError('This zip package is truncated.')
  const names: string[] = []
  const utf8 = new TextDecoder()
  let total = 0
  let p = cdOffset
  for (let k = 0; k < count; k++) {
    if (p + 46 > len || view.getUint32(p, true) !== CENTRAL) {
      throw new NotAZipError('This zip package has a damaged directory.')
    }
    const flags = view.getUint16(p + 8, true)
    const uncompressed = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    if (uncompressed === 0xffffffff) {
      throw new PackageTooLargeError('This presentation holds a part too large to open here.')
    }
    total += uncompressed
    if (total > limits.maxTotalBytes) {
      throw new PackageTooLargeError('This presentation unpacks to more data than this app opens.')
    }
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen)
    // fflate reads a name without the UTF-8 flag (bit 11) as Latin-1, code
    // point for byte; the names here must be the keys it returns.
    names.push(flags & 0x800 ? utf8.decode(nameBytes) : String.fromCharCode(...nameBytes))
    p += 46 + nameLen + extraLen + commentLen
  }
  return names
}

export type ZipContents = {
  /** Entry names in the package's own order. */
  names: string[]
  files: Map<string, Uint8Array>
}

/** Inflate every entry. Throws NotAZipError / PackageTooLargeError. */
export function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): ZipContents {
  const names = listEntries(bytes, limits)
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(bytes)
  } catch {
    throw new NotAZipError('This zip package is damaged.')
  }
  const files = new Map<string, Uint8Array>()
  for (const name of names) {
    const data = raw[name]
    if (data) files.set(name, data)
  }
  // fflate may know entries the directory walk did not (it should not); keep them too.
  for (const [name, data] of Object.entries(raw)) {
    if (!files.has(name)) {
      files.set(name, data)
      names.push(name)
    }
  }
  return { names: names.filter((n) => files.has(n)), files }
}

/** Already-compressed media gain nothing from deflate: store them as they are. */
const STORED = /\.(png|jpe?g|gif|webp|mp4|m4v|mov|mp3|m4a|wma|wmv|avi|zip)$/i

/** Write entries in the given order. */
export function writeZip(entries: Iterable<[string, Uint8Array]>): Uint8Array {
  const zippable: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [name, data] of entries) {
    zippable[name] = [data, { level: STORED.test(name) || name.endsWith('/') ? 0 : 6 }]
  }
  return zipSync(zippable)
}
