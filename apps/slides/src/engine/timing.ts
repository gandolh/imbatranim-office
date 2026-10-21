/**
 * Keeping a slide's animations valid when the editor removes what they
 * target. PowerPoint repairs (and the user sees a broken file) when a timing
 * node names a shape id that is gone, or a paragraph range past the end of a
 * shape's text. So deleting a shape removes the effects that animate it, as
 * PowerPoint's own Delete does, and shortening a shape's text removes the
 * effects on the paragraphs that no longer exist. Everything else in
 * `p:timing` is left as it was.
 */
import { NS } from './ns.ts'
import type { XmlElement } from './xml.ts'

/** The effect node a target sits in: the nearest `p:par` whose `p:cTn` has a presetClass. */
function effectOf(target: XmlElement): XmlElement | null {
  for (let el = target.parent; el; el = el.parent) {
    const cTn = el.is(NS.p, 'par') ? el.child(NS.p, 'cTn') : null
    if (cTn && cTn.attr('presetClass') !== null) return el
    if (el.is(NS.p, 'timing')) return null
  }
  return null
}

/**
 * Remove `el`, then every time container left with an empty child list (a
 * `p:childTnLst` must hold at least one node): the with-group, the click
 * group, the sequence, and finally the whole `p:timing` when nothing is left.
 */
function removeUpward(el: XmlElement, timing: XmlElement): void {
  let node: XmlElement | null = el
  while (node) {
    const parent: XmlElement | null = node.parent
    node.remove()
    if (!parent || parent.elements().length > 0) break
    if (parent.is(NS.p, 'tnLst')) {
      timing.remove()
      return
    }
    // An empty childTnLst: its p:cTn's owner (a p:par or p:seq) goes next.
    const owner: XmlElement | null = parent.parent?.parent ?? null
    if (!owner) break
    if (owner.parent?.is(NS.p, 'tnLst')) {
      timing.remove()
      return
    }
    node = owner
  }
  if (timing.parent && timing.descendants(NS.p, 'spTgt').length === 0) timing.remove()
}

function targets(timing: XmlElement, shapeId: string): XmlElement[] {
  return timing.descendants(NS.p, 'spTgt').filter((t) => t.attr('spid') === shapeId)
}

function pruneBuildList(timing: XmlElement, keep: (bldP: XmlElement) => boolean): void {
  const list = timing.child(NS.p, 'bldLst')
  if (!list) return
  for (const b of list.elements()) if (!keep(b)) b.remove()
  if (list.elements().length === 0) list.remove()
}

/** A shape was deleted: drop every effect on it. Returns true when the timing changed. */
export function pruneTimingForShape(slideRoot: XmlElement, shapeId: string): boolean {
  const timing = slideRoot.child(NS.p, 'timing')
  if (!timing) return false
  const hits = targets(timing, shapeId)
  const builds =
    timing
      .child(NS.p, 'bldLst')
      ?.elements()
      .filter((b) => b.attr('spid') === shapeId) ?? []
  if (hits.length === 0 && builds.length === 0) return false
  for (const t of hits) {
    if (!t.parent) continue // already removed with an earlier effect
    const effect = effectOf(t)
    if (effect && effect.parent) removeUpward(effect, timing)
  }
  if (timing.parent) pruneBuildList(timing, (b) => b.attr('spid') !== shapeId)
  return true
}

/**
 * A shape's text now has `count` paragraphs: drop effects whose paragraph
 * range reaches past the end. Returns true when the timing changed.
 */
export function pruneTimingForParagraphs(
  slideRoot: XmlElement,
  shapeId: string,
  count: number
): boolean {
  const timing = slideRoot.child(NS.p, 'timing')
  if (!timing) return false
  let changed = false
  for (const t of targets(timing, shapeId)) {
    if (!t.parent) continue
    const range = t.path([NS.p, 'txEl'], [NS.p, 'pRg'])
    if (!range) continue
    const end = Number(range.attr('end'))
    if (Number.isFinite(end) && end >= count) {
      const effect = effectOf(t)
      if (effect && effect.parent) {
        removeUpward(effect, timing)
        changed = true
      }
    }
  }
  if (changed && timing.parent && targets(timing, shapeId).length === 0) {
    pruneBuildList(timing, (b) => b.attr('spid') !== shapeId)
  }
  return changed
}
