import { describe, expect, it } from 'vitest'
import { NS } from './ns'
import {
  createElement,
  decodeXml,
  escapeText,
  importInto,
  parseFragment,
  parseXml,
  XmlParseError,
} from './xml'

const SLIDE = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<!-- a comment --><p:sld xmlns:a="${NS.a}" xmlns:p="${NS.p}" xmlns:r="${NS.r}"
  xmlns:mc="${NS.mc}" mc:Ignorable="p14"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name='Title &amp; more'/></p:nvSpPr>
    <p:txBody><a:p><a:r><a:t>Fish &amp; chips &lt;3 &#x2019; &#8217;</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld><![CDATA[ raw <x> ]]><?pi data?></p:sld>
`

describe('the lossless XML tree', () => {
  it('serializes an untouched document to exactly its source', () => {
    expect(parseXml(SLIDE).serialize()).toBe(SLIDE)
  })

  it('keeps every byte when each element is rebuilt from its children', () => {
    const doc = parseXml(SLIDE)
    const walk = (el: ReturnType<typeof parseXml>['root']): void => {
      el.touch()
      for (const c of el.elements()) walk(c)
    }
    walk(doc.root)
    expect(doc.serialize()).toBe(SLIDE)
  })

  it('changes only the edited text, leaving entities and quoting elsewhere as written', () => {
    const doc = parseXml(SLIDE)
    const t = doc.root.descendants(NS.a, 't')[0]
    t.setText('New & <improved>')
    const out = doc.serialize()
    expect(out).toBe(
      SLIDE.replace('Fish &amp; chips &lt;3 &#x2019; &#8217;', 'New &amp; &lt;improved&gt;')
    )
    expect(out).toContain("name='Title &amp; more'")
  })

  it('decodes text and attributes', () => {
    const doc = parseXml(SLIDE)
    expect(doc.root.descendants(NS.a, 't')[0].textContent()).toBe('Fish & chips <3 ’ ’')
    expect(doc.root.descendants(NS.p, 'cNvPr')[0].attr('name')).toBe('Title & more')
    expect(decodeXml('&amp;lt;')).toBe('&lt;')
  })

  it('resolves names by namespace, not by prefix', () => {
    const doc = parseXml(
      `<x:sld xmlns:x="${NS.p}" xmlns:d="${NS.a}"><x:cSld><d:t>hi</d:t></x:cSld></x:sld>`
    )
    expect(doc.root.is(NS.p, 'sld')).toBe(true)
    expect(doc.root.path([NS.p, 'cSld'], [NS.a, 't'])?.textContent()).toBe('hi')
  })

  it('moves a child forward or back inside its own parent to the place asked', () => {
    const doc = parseXml('<l><a/><b/><c/><d/></l>')
    const [a, , c, d] = doc.root.elements()
    doc.root.insertBefore(a, d)
    expect(doc.serialize()).toBe('<l><b/><c/><a/><d/></l>')
    doc.root.insertAfter(d, c)
    expect(doc.serialize()).toBe('<l><b/><c/><d/><a/></l>')
  })

  it('builds new elements with the prefixes in scope, without redeclaring them', () => {
    const doc = parseXml(`<p:sld xmlns:a="${NS.a}" xmlns:p="${NS.p}"><p:cSld/></p:sld>`)
    const cSld = doc.root.child(NS.p, 'cSld')!
    const p = createElement(cSld, NS.a, 'p', 'x')
    // Built while detached: it still knows where it is going.
    const r = createElement(p, NS.a, 'r', 'x')
    p.append(r)
    cSld.append(p)
    expect(doc.serialize()).toBe(
      `<p:sld xmlns:a="${NS.a}" xmlns:p="${NS.p}"><p:cSld><a:p><a:r/></a:p></p:cSld></p:sld>`
    )
  })

  it('declares a prefix an imported fragment needs when the target lacks it', () => {
    const doc = parseXml(`<p:sld xmlns:p="${NS.p}"><p:cSld/></p:sld>`)
    const frag = parseFragment('<a:p><a:r/></a:p>', { a: NS.a })
    const cSld = doc.root.child(NS.p, 'cSld')!
    cSld.append(importInto(frag, cSld))
    expect(doc.serialize()).toBe(
      `<p:sld xmlns:p="${NS.p}"><p:cSld><a:p xmlns:a="${NS.a}"><a:r/></a:p></p:cSld></p:sld>`
    )
  })

  it('drops characters XML cannot carry from typed text', () => {
    expect(escapeText('a\u0001b\u000bc')).toBe('abc')
  })

  it('refuses markup that is not well formed', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError)
    expect(() => parseXml('<a>')).toThrow(XmlParseError)
    expect(() => parseXml('<a x=1/>')).toThrow(XmlParseError)
    expect(() => parseXml('')).toThrow(XmlParseError)
  })

  it('keeps a DOCTYPE as text and never expands its entities', () => {
    const src = '<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>'
    const doc = parseXml(src)
    expect(doc.root.textContent()).toBe('&e;')
    expect(doc.serialize()).toBe(src)
  })
})
