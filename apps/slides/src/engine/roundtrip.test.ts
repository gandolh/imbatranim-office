import { describe, expect, it } from 'vitest'
import { fixture } from '../testing/fixtures'
import { Deck } from './deck'
import { deleteShapes } from './edits'
import { NS } from './ns'
import { bytesEqual } from './opc'
import { childShapes, ownXfrm, placeholderOf, spTree, writeXfrm } from './shapes'
import { setPlainText } from './textEdit'
import { parseXml } from './xml'
import { readZip } from './zip'

function entries(bytes: Uint8Array): Map<string, Uint8Array> {
  return readZip(bytes).files
}

function titleOf(deck: Deck, part: string) {
  // rootForEdit: a change is recorded (for undo) before it is made.
  const tree = spTree(deck.pkg.rootForEdit(part))!
  return childShapes(tree).find((s) =>
    ['title', 'ctrTitle'].includes(placeholderOf(s)?.type ?? '')
  )!
}

const subtree = (xml: string, local: string) =>
  parseXml(xml)
    .root.descendants(NS.p, local)
    .map((e) => e.serialize())
    .join('')

/** The brief's spike sequence: title text, move and resize, add from a layout, delete, reorder. */
function spikeEdits(deck: Deck) {
  const slides = deck.slides()
  const edited = slides[0].part
  deck.pkg.begin()
  setPlainText(titleOf(deck, edited), 'Edited title')
  const tree = spTree(deck.pkg.rootForEdit(edited))!
  const body = childShapes(tree).find(
    (s) => placeholderOf(s)?.type === 'obj' || placeholderOf(s)?.type === 'body'
  )!
  const from = deck.resolvedXfrm(edited, body)!
  writeXfrm(body, { ...from, x: from.x + 457200, cx: from.cx * 0.8, cy: from.cy * 0.8 })
  const layout = deck.layouts().find((l) => l.type === 'obj')!
  const added = deck.addSlide(layout.part, 1)
  const deleted = deck.slides()[3]
  deck.deleteSlide(3)
  deck.moveSlide(2, 4)
  const change = deck.pkg.commit()
  return { edited, added, deleted, change }
}

describe('saving patches the package in place', () => {
  for (const name of ['anim.pptx', 'theme.pptx', 'notes.pptx'] as const) {
    it(`${name}: a save with no edits writes every part as it was`, () => {
      const original = fixture(name)
      const saved = Deck.open(original).pkg.save()
      const a = entries(original)
      const b = entries(saved)
      expect([...b.keys()]).toEqual([...a.keys()])
      for (const [k, v] of a) expect(bytesEqual(v, b.get(k)!), k).toBe(true)
    })

    it(`${name}: after the spike edits, every part they did not touch is byte identical`, () => {
      const original = fixture(name)
      const deck = Deck.open(original)
      const { edited, added, deleted } = spikeEdits(deck)
      const before = entries(original)
      const after = entries(deck.pkg.save())
      const touched = new Set([
        '[Content_Types].xml',
        'ppt/presentation.xml',
        'ppt/_rels/presentation.xml.rels',
        edited,
      ])
      const gone = new Set([
        deleted.part,
        deleted.part.replace('slides/', 'slides/_rels/') + '.rels',
      ])
      for (const [k, v] of before) {
        if (touched.has(k)) continue
        if (!after.has(k)) {
          // Only the deleted slide and what only it used may go (its notes page).
          expect(gone.has(k) || k.includes('notesSlide'), `${k} went missing`).toBe(true)
          continue
        }
        expect(bytesEqual(v, after.get(k)!), `${k} changed`).toBe(true)
      }
      for (const k of after.keys()) {
        if (before.has(k)) continue
        expect([added.part, added.part.replace('slides/', 'slides/_rels/') + '.rels']).toContain(k)
      }
    })

    it(`${name}: undoing every edit gives back the original bytes of every part`, () => {
      const original = fixture(name)
      const deck = Deck.open(original)
      const { change } = spikeEdits(deck)
      deck.pkg.restore(change!.before)
      const a = entries(original)
      const b = entries(deck.pkg.save())
      expect([...b.keys()].sort()).toEqual([...a.keys()].sort())
      for (const [k, v] of a) expect(bytesEqual(v, b.get(k)!), k).toBe(true)
    })
  }

  it('keeps the edited slide’s animations and transition exactly', () => {
    const original = fixture('anim.pptx')
    const deck = Deck.open(original)
    const { edited } = spikeEdits(deck)
    const a = new TextDecoder().decode(entries(original).get(edited))
    const b = new TextDecoder().decode(entries(deck.pkg.save()).get(edited))
    expect(subtree(a, 'timing')).not.toBe('')
    expect(subtree(b, 'timing')).toBe(subtree(a, 'timing'))
    expect(subtree(b, 'transition')).toBe(subtree(a, 'transition'))
    expect(b).toContain('Edited title')
  })

  it('writes a moved placeholder’s new frame as the first child of its spPr', () => {
    const deck = Deck.open(fixture('anim.pptx'))
    const part = deck.slides()[0].part
    const body = childShapes(spTree(deck.pkg.rootForEdit(part))!).find(
      (s) => placeholderOf(s)?.idx === '1'
    )!
    expect(ownXfrm(body)).toBeNull()
    const inherited = deck.resolvedXfrm(part, body)!
    writeXfrm(body, { ...inherited, x: 100, y: 200 })
    const spPr = body.child(NS.p, 'spPr')!
    expect(spPr.elements()[0].local).toBe('xfrm')
    expect(ownXfrm(body)).toMatchObject({ x: 100, y: 200, cx: inherited.cx, cy: inherited.cy })
  })
})

describe('slide operations', () => {
  it('adds a slide with the layout’s placeholders (no footers) and registers it', () => {
    const deck = Deck.open(fixture('theme.pptx'))
    const layout = deck.layouts().find((l) => l.type === 'twoObj')!
    deck.pkg.begin()
    const ref = deck.addSlide(layout.part, 0)
    deck.pkg.commit()
    expect(deck.slides()[0].part).toBe(ref.part)
    const types = childShapes(spTree(deck.pkg.root(ref.part)!)!).map((s) => placeholderOf(s)?.type)
    expect(types).toEqual(['title', 'obj', 'obj'])
    expect(deck.layoutOf(ref.part)).toBe(layout.part)
    expect(deck.pkg.contentType(ref.part)).toMatch(/slide\+xml$/)
    expect(new Set(deck.slides().map((s) => s.id)).size).toBe(deck.slides().length)
  })

  it('never reuses a deleted slide’s part name', () => {
    const deck = Deck.open(fixture('theme.pptx'))
    const last = deck.slides()[deck.slides().length - 1]
    deck.pkg.begin()
    deck.deleteSlide(deck.slides().length - 1)
    const ref = deck.addSlide(deck.layouts()[0].part, 0)
    deck.pkg.commit()
    expect(ref.part).not.toBe(last.part)
  })

  it('duplicates a slide with its own copy of its notes, pointing back at the copy', () => {
    const deck = Deck.open(fixture('anim.pptx'))
    const source = deck.slides()[0]
    deck.pkg.begin()
    const copy = deck.duplicateSlide(0)
    deck.pkg.commit()
    expect(deck.slides()[1].part).toBe(copy.part)
    const notes = deck.notesOf(copy.part)!
    expect(notes).not.toBe(deck.notesOf(source.part))
    expect(
      deck.pkg.targetOfType(
        notes,
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
      )
    ).toBe(copy.part)
    expect(deck.notesText(copy.part)).toBe(deck.notesText(source.part))
  })

  it('deletes a slide with its notes page and leaves no relationship pointing at either', () => {
    const deck = Deck.open(fixture('anim.pptx'))
    const target = deck.slides()[2]
    const notes = deck.notesOf(target.part)!
    deck.pkg.begin()
    deck.deleteSlide(2)
    deck.pkg.commit()
    expect(deck.pkg.has(target.part)).toBe(false)
    expect(deck.pkg.has(notes)).toBe(false)
    for (const part of deck.pkg.partNames()) {
      if (!part.endsWith('.rels')) continue
      const xml = new TextDecoder().decode(deck.pkg.bytes(part)!)
      expect(xml).not.toContain(target.part.split('/').pop())
    }
    expect(deck.pkg.contentType(target.part)).not.toMatch(/slide\+xml/)
  })

  it('reorders slides by moving their sldId, nothing else', () => {
    const deck = Deck.open(fixture('theme.pptx'))
    const order = deck.slides().map((s) => s.part)
    deck.pkg.begin()
    deck.moveSlide(0, 3)
    const change = deck.pkg.commit()!
    expect(deck.slides().map((s) => s.part)).toEqual([
      order[1],
      order[2],
      order[3],
      order[0],
      ...order.slice(4),
    ])
    expect([...change.after.keys()]).toEqual(['ppt/presentation.xml'])
  })

  it('keeps PowerPoint 2010 sections naming every slide once, in show order', () => {
    const deck = Deck.open(fixture('theme.pptx'))
    const ids = deck.slides().map((s) => s.id)
    // Give the deck two sections: the first two slides, then the rest.
    const pres = deck.pkg.rootForEdit(deck.presPart)
    const ext =
      `<p:extLst xmlns:p="${NS.p}"><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="${NS.p14}">` +
      `<p14:section name="One" id="{1}"><p14:sldIdLst>${ids
        .slice(0, 2)
        .map((i) => `<p14:sldId id="${i}"/>`)
        .join('')}</p14:sldIdLst></p14:section>` +
      `<p14:section name="Two" id="{2}"><p14:sldIdLst>${ids
        .slice(2)
        .map((i) => `<p14:sldId id="${i}"/>`)
        .join('')}</p14:sldIdLst></p14:section>` +
      `</p14:sectionLst></p:ext></p:extLst>`
    pres.append(parseXml(ext).root)
    deck.pkg.begin()
    deck.moveSlide(0, 3)
    const added = deck.addSlide(deck.layouts()[0].part, 0)
    deck.deleteSlide(2)
    deck.pkg.commit()
    const sectionIds = pres
      .descendants(NS.p14, 'section')
      .map((s) => s.descendants(NS.p14, 'sldId').map((e) => Number(e.attr('id'))))
    expect(sectionIds.flat()).toEqual(deck.slides().map((s) => s.id))
    expect(sectionIds.flat()).toContain(added.id)
  })
})

describe('notes', () => {
  it('reads each slide’s notes through its relationship, not by file number', () => {
    // Slides 1, 2, 4 and 5 have notes; slide 3 has none, so notesSlide3 belongs to slide 4.
    const deck = Deck.open(fixture('notes.pptx'))
    const notes = deck.slides().map((s) => deck.notesText(s.part))
    expect(notes[0]).toContain('remember to breathe')
    expect(notes[1]).toBe('Note two.')
    expect(notes[2]).toBe('')
    expect(notes[3]).toContain('Note four')
    expect(notes[4]).toBe('Final note.')
  })

  it('writes notes, and makes a notes page for a slide that had none', () => {
    const deck = Deck.open(fixture('notes.pptx'))
    const third = deck.slides()[2].part
    deck.pkg.begin()
    deck.setNotesText(third, 'Line one\nLine two')
    deck.setNotesText(deck.slides()[0].part, 'Replaced')
    deck.pkg.commit()
    const reopened = Deck.open(deck.pkg.save())
    expect(reopened.notesText(reopened.slides()[2].part)).toBe('Line one\nLine two')
    expect(reopened.notesText(reopened.slides()[0].part)).toBe('Replaced')
    expect(reopened.notesText(reopened.slides()[1].part)).toBe('Note two.')
  })

  it('gives a deck that never had notes a notes master, then the notes page', () => {
    const deck = Deck.open(fixture('theme.pptx'))
    expect(deck.notesMaster()).toBeNull()
    const part = deck.slides()[0].part
    deck.pkg.begin()
    deck.setNotesText(part, 'First note')
    deck.pkg.commit()
    const reopened = Deck.open(deck.pkg.save())
    expect(reopened.notesMaster()).not.toBeNull()
    expect(reopened.notesText(reopened.slides()[0].part)).toBe('First note')
    const pres = new TextDecoder().decode(reopened.pkg.bytes(reopened.presPart)!)
    expect(pres.indexOf('notesMasterIdLst')).toBeGreaterThan(pres.indexOf('sldMasterIdLst'))
    expect(pres.indexOf('notesMasterIdLst')).toBeLessThan(pres.indexOf('sldIdLst'))
  })
})

describe('animations stay valid', () => {
  it('deleting the animated shape removes its effect and build entry', () => {
    const deck = Deck.open(fixture('anim.pptx'))
    const part = deck.slides()[0].part
    deck.pkg.begin()
    deleteShapes(deck, part, ['3'])
    deck.pkg.commit()
    const xml = new TextDecoder().decode(deck.pkg.bytes(part)!)
    expect(xml).not.toContain('spid="3"')
    // That was the slide's only effect: no empty timing tree is left behind.
    expect(xml).not.toContain('<p:timing')
    expect(xml).toContain('<p:transition')
    expect(() => parseXml(xml)).not.toThrow()
  })

  it('deleting one shape keeps the effects on the others', () => {
    const deck = Deck.open(fixture('anim.pptx'))
    const part = deck.slides()[0].part
    const root = deck.pkg.rootForEdit(part)
    // Animate the title (id 2) too: a second click effect, copied from the first.
    const clickPar = root
      .descendants(NS.p, 'par')
      .find((p) => p.child(NS.p, 'cTn')?.attr('id') === '3')!
    const copy = parseXml(
      clickPar
        .serialize()
        .replace(/spid="3"/g, 'spid="2"')
        .replace(/cTn id="(\d)"/g, 'cTn id="1$1"')
    ).root
    clickPar.parent!.append(copy)
    deck.pkg.begin()
    deleteShapes(deck, part, ['3'])
    deck.pkg.commit()
    const xml = new TextDecoder().decode(deck.pkg.bytes(part)!)
    expect(xml).toContain('<p:timing')
    expect(xml).toContain('spid="2"')
    expect(xml).not.toContain('spid="3"')
  })
})
