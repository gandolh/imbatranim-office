import { describe, expect, it } from 'vitest'
import { fixture } from '../testing/fixtures'
import { blankPresentation } from './blank'
import { css, hexToRgba, resolveColor } from './color'
import { Deck } from './deck'
import { customPaths, presetPath } from './geometry'
import { autoNumberLabel, buildSlide, MediaCache } from './model'
import { NS } from './ns'
import { parseXml } from './xml'

function model(bytes: Uint8Array, index = 0) {
  const deck = Deck.open(bytes)
  return {
    deck,
    slide: buildSlide(deck, deck.slides()[index].part, index + 1, new MediaCache(deck)),
  }
}

describe('the render model', () => {
  it('gives a placeholder the frame and text style of its layout and master', () => {
    const { deck, slide } = model(fixture('theme.pptx'))
    const title = slide.shapes.find((s) => s.placeholder?.type === 'title')!
    const layout = deck.layoutOf(deck.slides()[0].part)!
    expect(title.box.cx).toBeGreaterThan(0)
    expect(deck.resolvedXfrm(deck.slides()[0].part, title.el!)).toMatchObject({
      x: title.box.x,
      cx: title.box.cx,
    })
    expect(layout).toMatch(/slideLayout/)
    const run = title.text!.paragraphs[0].runs[0]
    expect(run.kind).toBe('text')
    // The theme's major font (Georgia) and a title size from the master's title style.
    expect(run.style.font).toBe('Georgia')
    expect(run.style.sizePt).toBeGreaterThan(30)
  })

  it('uses the theme fonts and colours of the custom theme', () => {
    const { slide } = model(fixture('theme.pptx'))
    const body = slide.shapes.find((s) => s.placeholder?.idx === '1')!
    expect(body.text!.paragraphs[0].runs[0].style.font).toBe('Verdana')
    // The master's background (F1FAEE) shows through.
    expect(slide.background).toEqual({ kind: 'solid', color: hexToRgba('F1FAEE') })
  })

  it('draws a bullet from the body style', () => {
    const { slide } = model(fixture('anim.pptx'))
    const body = slide.shapes.find((s) => s.placeholder?.idx === '1')!
    expect(body.text!.paragraphs[0].bullet).toMatchObject({ kind: 'char' })
  })

  it('shows an empty placeholder’s prompt (and only in the editor’s model fields)', () => {
    const deck = Deck.open(blankPresentation())
    const slide = buildSlide(deck, deck.slides()[0].part, 1, new MediaCache(deck))
    expect(slide.shapes.map((s) => s.prompt)).toEqual([
      'Click to add title',
      'Click to add subtitle',
    ])
  })

  it('numbers slides in slide-number fields', () => {
    const deck = Deck.open(blankPresentation())
    const layout = deck.layouts()[0].part
    const tree = deck.pkg.root(layout)!
    const sldNum = tree.descendants(NS.a, 'fld')[0]
    expect(sldNum.attr('type')).toBe('slidenum')
  })

  it('labels automatic numbering', () => {
    expect(autoNumberLabel('arabicPeriod', 3)).toBe('3.')
    expect(autoNumberLabel('romanUcPeriod', 4)).toBe('IV.')
    expect(autoNumberLabel('alphaLcParenR', 28)).toBe('ab)')
    expect(autoNumberLabel('arabicParenBoth', 1)).toBe('(1)')
  })
})

describe('colours', () => {
  const ctx = {
    scheme: { accent1: '4472C4', dk1: '000000', lt1: 'FFFFFF' },
    map: { tx1: 'dk1', bg1: 'lt1' },
  }
  const color = (xml: string) =>
    resolveColor(parseXml(`<x xmlns:a="${NS.a}">${xml}</x>`).root.elements()[0], ctx)

  it('maps scheme colours through the colour map', () => {
    expect(css(color('<a:schemeClr val="tx1"/>'))).toBe('#000000')
    expect(css(color('<a:schemeClr val="accent1"/>'))).toBe('#4472c4')
  })

  it('applies lumMod/lumOff and alpha', () => {
    // White at 50% luminance is mid grey.
    expect(css(color('<a:srgbClr val="FFFFFF"><a:lumMod val="50000"/></a:srgbClr>'))).toBe(
      '#808080'
    )
    expect(color('<a:srgbClr val="FF0000"><a:alpha val="25000"/></a:srgbClr>')?.a).toBeCloseTo(0.25)
  })

  it('tints toward white and shades toward black', () => {
    const tinted = color('<a:srgbClr val="000000"><a:tint val="0"/></a:srgbClr>')!
    expect(css(tinted)).toBe('#ffffff')
    const shaded = color('<a:srgbClr val="FFFFFF"><a:shade val="0"/></a:srgbClr>')!
    expect(css(shaded)).toBe('#000000')
  })
})

describe('geometry', () => {
  it('draws presets in the shape box and falls back to a rectangle', () => {
    expect(presetPath('rect', 10, 20)[0].d).toBe('M0,0 L10,0 L10,20 L0,20 Z')
    expect(presetPath('no-such-preset', 10, 20)[0].d).toBe('M0,0 L10,0 L10,20 L0,20 Z')
    expect(presetPath('line', 10, 20)[0]).toMatchObject({ filled: false })
    expect(presetPath('ellipse', 10, 10)[0].d).toContain('A5,5')
  })

  it('scales custom geometry from its own path space', () => {
    const geom = parseXml(
      `<a:custGeom xmlns:a="${NS.a}"><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`
    ).root
    expect(customPaths(geom, 200, 20)[0].d).toBe('M0,0 L200,10 Z')
  })
})
