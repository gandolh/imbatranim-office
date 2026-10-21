import { describe, expect, it } from 'vitest'
import { fixture } from '../testing/fixtures'
import { blankPresentation } from './blank'
import { Deck } from './deck'
import {
  alignShapesText,
  copyShapes,
  deleteShapes,
  fillShapes,
  formatShapesText,
  insertPicture,
  insertShape,
  insertTextBox,
  pasteShapes,
  restackShapes,
  setShapeBox,
  writeShapeText,
} from './edits'
import { unsupportedReason, sniffReason } from './formats'
import { NS, REL } from './ns'
import { childShapes, findShape, ownXfrm, shapeId, spTree } from './shapes'
import { parseXml } from './xml'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const box = { x: 914400, y: 914400, cx: 1828800, cy: 914400 }

function edit<T>(deck: Deck, fn: () => T): T {
  deck.pkg.begin()
  const out = fn()
  deck.pkg.commit()
  return out
}

const slideXml = (deck: Deck, part: string) => new TextDecoder().decode(deck.pkg.bytes(part)!)
const ids = (deck: Deck, part: string) =>
  childShapes(spTree(deck.pkg.root(part)!)!).map((s) => shapeId(s))

describe('inserting', () => {
  it('adds a text box, a themed shape and a picture at the top of the z-order', () => {
    const deck = Deck.open(blankPresentation())
    const part = deck.slides()[0].part
    const text = edit(deck, () => insertTextBox(deck, part, box))
    const star = edit(deck, () => insertShape(deck, part, 'star5', box))
    const pic = edit(deck, () => insertPicture(deck, part, PNG, 'png', box, 'sun.png'))
    expect(ids(deck, part).slice(-3)).toEqual([text, star, pic])
    const xml = slideXml(deck, part)
    expect(xml).toContain('txBox="1"')
    expect(xml).toContain('prst="star5"')
    expect(xml).toContain('<a:fillRef idx="1"><a:schemeClr val="accent1"/>')
    // The picture's bytes are a new media part, typed by its extension, related from the slide.
    const media = deck.pkg.targetOfType(part, REL.image)!
    expect(deck.pkg.bytes(media)).toEqual(PNG)
    expect(deck.pkg.contentType(media)).toBe('image/png')
    // No redundant namespace declarations on what was built.
    expect(xml.match(/xmlns:a=/g)).toHaveLength(1)
  })
})

describe('moving, deleting and restacking', () => {
  it('writes a new frame and restacks without touching other shapes', () => {
    const deck = Deck.open(blankPresentation())
    const part = deck.slides()[0].part
    const a = edit(deck, () => insertShape(deck, part, 'rect', box))
    const b = edit(deck, () => insertShape(deck, part, 'ellipse', box))
    edit(deck, () =>
      setShapeBox(deck, part, a, { ...box, x: 5, y: 6, rot: 30, flipH: true, flipV: false })
    )
    const el = findShape(spTree(deck.pkg.root(part)!)!, a)!
    expect(ownXfrm(el)).toMatchObject({ x: 5, y: 6, rot: 30, flipH: true })
    edit(deck, () => restackShapes(deck, part, [b], 'back'))
    expect(ids(deck, part).indexOf(b)).toBeLessThan(ids(deck, part).indexOf(a))
    edit(deck, () => deleteShapes(deck, part, [a]))
    expect(ids(deck, part)).not.toContain(a)
  })
})

describe('text and fills', () => {
  it('formats every run of a shape and aligns its paragraphs', () => {
    const deck = Deck.open(fixture('theme.pptx'))
    const part = deck.slides()[0].part
    const title = childShapes(spTree(deck.pkg.root(part)!)!)[0]
    const id = shapeId(title)!
    edit(deck, () => formatShapesText(deck, part, [id], { bold: true, size: 40, color: 'ff0000' }))
    edit(deck, () => alignShapesText(deck, part, [id], 'ctr'))
    const xml = slideXml(deck, part)
    expect(xml).toMatch(/<a:rPr[^>]* b="1"[^>]* sz="4000"/)
    expect(xml).toContain('<a:srgbClr val="FF0000"/>')
    expect(xml).toContain('algn="ctr"')
  })

  it('keeps paragraphs marked unchanged as they were, and builds the rest', () => {
    const deck = Deck.open(fixture('anim.pptx'))
    const part = deck.slides()[0].part
    const body = findShape(spTree(deck.pkg.root(part)!)!, '3')!
    const p = body.descendants(NS.a, 'p')[0]
    const before = p.serialize()
    edit(deck, () =>
      writeShapeText(deck, part, '3', [
        { runs: [], source: p, keep: true },
        { runs: [{ text: 'Added line', base: null, format: { italic: true } }], source: p },
      ])
    )
    const xml = slideXml(deck, part)
    expect(xml).toContain(before)
    expect(xml).toContain('<a:t>Added line</a:t>')
    expect(xml).toContain('i="1"')
  })

  it('fills and empties a shape’s fill in its schema place', () => {
    const deck = Deck.open(blankPresentation())
    const part = deck.slides()[0].part
    const id = edit(deck, () => insertShape(deck, part, 'rect', box))
    edit(deck, () => fillShapes(deck, part, [id], '00ff00'))
    expect(slideXml(deck, part)).toContain(
      '</a:prstGeom><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>'
    )
    edit(deck, () => fillShapes(deck, part, [id], null))
    expect(slideXml(deck, part)).toContain('</a:prstGeom><a:noFill/>')
  })
})

describe('copy and paste', () => {
  it('pastes into another deck with the picture copied and fresh ids', () => {
    const from = Deck.open(blankPresentation())
    const fromPart = from.slides()[0].part
    const pic = edit(from, () => insertPicture(from, fromPart, PNG, 'png', box, 'sun.png'))
    const clip = copyShapes(from, fromPart, [pic])!
    const to = Deck.open(fixture('anim.pptx'))
    const toPart = to.slides()[0].part
    const [pasted] = edit(to, () => pasteShapes(to, toPart, clip, 0))
    expect(pasted).not.toBe('2')
    const media = to.pkg.target(
      toPart,
      findShape(spTree(to.pkg.root(toPart)!)!, pasted)!
        .descendants(NS.a, 'blip')[0]
        .attrNS(NS.r, 'embed')!
    )!
    expect(to.pkg.bytes(media)).toEqual(PNG)
  })

  it('drops a pasted hyperlink to a slide of another deck instead of leaving it dangling', () => {
    const from = Deck.open(fixture('anim.pptx'))
    const fromPart = from.slides()[0].part
    // Give the title a jump to slide 2.
    const slide2 = from.slides()[1].part
    const rId = edit(from, () => from.pkg.addRelationship(fromPart, REL.slide, slide2))
    const root = from.pkg.rootForEdit(fromPart)
    const rPr = parseXml(
      `<a:rPr xmlns:a="${NS.a}" xmlns:r="${NS.r}" lang="en-US"><a:hlinkClick r:id="${rId}" action="ppaction://hlinksldjump"/></a:rPr>`
    ).root
    root.descendants(NS.a, 'r')[0].insert(rPr, 0)
    const clip = copyShapes(from, fromPart, ['2'])!
    const to = Deck.open(blankPresentation())
    const toPart = to.slides()[0].part
    const [pasted] = edit(to, () => pasteShapes(to, toPart, clip, 0))
    expect(pasted).toBeDefined()
    const xml = slideXml(to, toPart)
    expect(xml).not.toContain('hlinkClick')
    expect(to.pkg.relationships(toPart).some((r) => r.type === REL.slide)).toBe(false)
  })

  it('offsets a paste on the same slide so the copy does not hide the original', () => {
    const deck = Deck.open(blankPresentation())
    const part = deck.slides()[0].part
    const a = edit(deck, () => insertShape(deck, part, 'rect', box))
    const [b] = edit(deck, () => pasteShapes(deck, part, copyShapes(deck, part, [a])!, 182880))
    const tree = spTree(deck.pkg.root(part)!)!
    expect(ownXfrm(findShape(tree, b)!)!.x).toBe(box.x + 182880)
  })
})

describe('what Slides opens', () => {
  it('refuses the old binary format and other apps’ files by name', () => {
    expect(unsupportedReason('a/b.pptx')).toBeNull()
    expect(unsupportedReason('deck.PPTX')).toBeNull()
    expect(unsupportedReason('old.ppt')).toBe(
      'PowerPoint 97-2003 (.ppt) is not supported. Slides reads .pptx files.'
    )
    expect(unsupportedReason('notes.docx')).toBe(
      '.docx files open in Docs. Slides reads .pptx files.'
    )
    expect(unsupportedReason('README')).toMatch(/no extension/)
  })

  it('recognises an old-format or protected file renamed .pptx from its first bytes', () => {
    expect(sniffReason(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toMatch(
      /97-2003/
    )
    expect(sniffReason(new TextEncoder().encode('hello'))).toMatch(/not a readable/)
    expect(sniffReason(new Uint8Array([0x50, 0x4b, 3, 4]))).toBeNull()
  })
})

describe('a new presentation', () => {
  it('has six layouts, a notes master and one title slide, and every layout makes a slide', () => {
    const deck = Deck.open(blankPresentation())
    expect(deck.layouts().map((l) => l.name)).toEqual([
      'Title Slide',
      'Title and Content',
      'Section Header',
      'Two Content',
      'Title Only',
      'Blank',
    ])
    expect(deck.notesMaster()).not.toBeNull()
    expect(deck.slides()).toHaveLength(1)
    edit(deck, () => {
      for (const l of deck.layouts()) deck.addSlide(l.part, deck.slides().length)
    })
    const reopened = Deck.open(deck.pkg.save())
    expect(reopened.slides()).toHaveLength(7)
  })
})
