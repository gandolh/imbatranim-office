/**
 * A raw pass over an ASCII DXF: group-code/value pairs, the entity records of
 * ENTITIES and of each BLOCK, and the LAYER table records. The parser
 * (dxf-viewer's) gives the meaning of the entities we model; this pass keeps
 * every group code of the ones we do not, so they are written back as read,
 * and the few layer fields the parser drops (linetype, locked, lineweight).
 */
import type { Tag } from '../model/types'

export function decodeDxf(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Pre-2007 files are in their $DWGCODEPAGE, nearly always ANSI_1252.
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Why a file cannot be read as ASCII DXF, or null when it looks like one. */
export function refuseReason(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 32))
  if (head.startsWith('AutoCAD Binary DXF'))
    return 'This is a binary DXF. CAD reads ASCII DXF files only.'
  if (/^AC10\d\d/.test(head))
    return 'This is a DWG drawing. CAD opens DXF files; save it as DXF first.'
  const text = head.replace(/^\uFEFF/, '').trimStart()
  if (!/^(0|999)\s/.test(text)) return 'This file is not a DXF drawing.'
  return null
}

export function tokenize(text: string): Tag[] {
  const lines = text.split(/\r\n|\n|\r/)
  const out: Tag[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10)
    if (Number.isNaN(code)) break
    // Values keep leading spaces (text can start with one); trailing CR is gone already.
    out.push([code, lines[i + 1]])
  }
  return out
}

/** One entity's group codes (after its `0 TYPE`), with VERTEX/ATTRIB/SEQEND children folded in. */
export type RawEntity = { type: string; tags: Tag[]; children: RawEntity[] }

export type RawSections = {
  header: Map<string, Tag[]>
  layers: Map<string, Map<number, string>>
  entities: RawEntity[]
  blocks: Map<string, RawEntity[]>
  /** APPID names (xdata owners). */
  appIds: string[]
}

const SUB_ENTITIES = new Set(['VERTEX', 'ATTRIB', 'SEQEND'])

function readEntities(
  tags: Tag[],
  start: number,
  stop: (type: string) => boolean
): { list: RawEntity[]; next: number } {
  const list: RawEntity[] = []
  let cur: RawEntity | null = null
  let i = start
  for (; i < tags.length; i++) {
    const [code, value] = tags[i]
    if (code === 0) {
      const type = value.trim()
      if (stop(type)) break
      const rec: RawEntity = { type, tags: [], children: [] }
      if (SUB_ENTITIES.has(type) && list.length > 0) {
        list[list.length - 1].children.push(rec)
      } else list.push(rec)
      cur = rec
      continue
    }
    cur?.tags.push(tags[i])
  }
  return { list, next: i }
}

export function rawSections(tags: Tag[]): RawSections {
  const out: RawSections = {
    header: new Map(),
    layers: new Map(),
    entities: [],
    blocks: new Map(),
    appIds: [],
  }
  let i = 0
  while (i < tags.length) {
    const [code, value] = tags[i]
    if (code === 0 && value.trim() === 'SECTION' && tags[i + 1]?.[0] === 2) {
      const name = tags[i + 1][1].trim()
      i += 2
      if (name === 'HEADER') {
        let varName = ''
        for (; i < tags.length && !(tags[i][0] === 0 && tags[i][1].trim() === 'ENDSEC'); i++) {
          if (tags[i][0] === 9) {
            varName = tags[i][1].trim()
            out.header.set(varName, [])
          } else if (varName) out.header.get(varName)?.push(tags[i])
        }
      } else if (name === 'TABLES') {
        let table = ''
        let record: Map<number, string> | null = null
        let recordType = ''
        const flush = () => {
          if (record && recordType === 'LAYER' && record.has(2))
            out.layers.set(record.get(2)!.trim(), record)
          if (record && recordType === 'APPID' && record.has(2))
            out.appIds.push(record.get(2)!.trim())
          record = null
        }
        for (; i < tags.length && !(tags[i][0] === 0 && tags[i][1].trim() === 'ENDSEC'); i++) {
          const [c, v] = tags[i]
          if (c === 0) {
            flush()
            const t = v.trim()
            if (t === 'TABLE') {
              table = tags[i + 1]?.[0] === 2 ? tags[i + 1][1].trim() : ''
              recordType = ''
            } else if (t === 'ENDTAB') recordType = ''
            else if (t === table) {
              recordType = t
              record = new Map()
            }
            continue
          }
          if (record && !(record as Map<number, string>).has(c))
            (record as Map<number, string>).set(c, v)
        }
        flush()
      } else if (name === 'BLOCKS') {
        while (i < tags.length && !(tags[i][0] === 0 && tags[i][1].trim() === 'ENDSEC')) {
          if (tags[i][0] === 0 && tags[i][1].trim() === 'BLOCK') {
            let blockName = ''
            i++
            for (; i < tags.length && tags[i][0] !== 0; i++)
              if (tags[i][0] === 2 && !blockName) blockName = tags[i][1].trim()
            const { list, next } = readEntities(tags, i, (t) => t === 'ENDBLK')
            out.blocks.set(blockName, list)
            i = next
          }
          i++
        }
      } else if (name === 'ENTITIES') {
        const { list, next } = readEntities(tags, i, (t) => t === 'ENDSEC')
        out.entities = list
        i = next
      }
      continue
    }
    i++
  }
  return out
}

export const tagValue = (tags: readonly Tag[], code: number): string | undefined =>
  tags.find((t) => t[0] === code)?.[1]

export function tagNumber(tags: readonly Tag[], code: number): number | undefined {
  const v = tagValue(tags, code)
  if (v === undefined) return undefined
  const n = Number(v.trim())
  return Number.isFinite(n) ? n : undefined
}

/** Repeated point codes (10/20, 11/21 …) as a list. */
export function tagPoints(tags: readonly Tag[], xCode = 10): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < tags.length; i++) {
    if (tags[i][0] === xCode) {
      const x = Number(tags[i][1])
      const yTag = tags[i + 1]
      const y = yTag && yTag[0] === xCode + 10 ? Number(yTag[1]) : 0
      pts.push({ x, y })
    }
  }
  return pts
}
