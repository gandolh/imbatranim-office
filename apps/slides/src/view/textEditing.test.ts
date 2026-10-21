// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { fixture } from '../testing/fixtures'
import { Deck } from '../engine/deck'
import { buildSlide, MediaCache, type ShapeModel } from '../engine/model'
import { buildEditableText, readEditableText } from './textEditing'

const SCALE = 960 / 9144000

function titleShape(): ShapeModel {
  const deck = Deck.open(fixture('notes.pptx'))
  const slide = buildSlide(deck, deck.slides()[0].part, 1, new MediaCache(deck))
  return slide.shapes.find((s) => s.text && s.text.paragraphs.some((p) => p.runs.length))!
}

/**
 * jsdom has no layout, so the browser's computed styles are stood in for by
 * reading the inline styles the editor (and execCommand) write.
 */
const measure = (el: Element) => {
  let weight = 400
  let italic = false
  let sizePx = 0
  let color = null
  for (let e: Element | null = el; e && e instanceof HTMLElement; e = e.parentElement) {
    const s = e.style
    if (s.fontWeight && weight === 400)
      weight = Number(s.fontWeight) || (s.fontWeight === 'bold' ? 700 : 400)
    if (e.tagName === 'B' && weight === 400) weight = 700
    if (s.fontStyle && !italic) italic = s.fontStyle === 'italic'
    if (s.fontSize && !sizePx) sizePx = parseFloat(s.fontSize)
    if (s.color && !color) {
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(s.color)
      if (m) color = { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: 1 }
    }
    if (e.dataset.textEditor !== undefined) break
  }
  return { weight, italic, sizePx, color }
}

function editor(shape: ShapeModel) {
  const root = document.createElement('div')
  root.dataset.textEditor = ''
  document.body.append(root)
  buildEditableText(root, shape.text, SCALE, shape.text?.paragraphs[0] ?? null)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('in-place text editing', () => {
  it('reads untouched text back as the same paragraphs, kept as they were', () => {
    const shape = titleShape()
    const root = editor(shape)
    const out = readEditableText(root, shape.text, SCALE, measure)
    expect(out).toHaveLength(shape.text!.paragraphs.length)
    expect(out.every((p) => p.keep)).toBe(true)
  })

  it('keeps the run’s own properties for typed text, with no formatting invented', () => {
    const shape = titleShape()
    const root = editor(shape)
    const span = root.querySelector('[data-r]')!
    span.textContent = 'A new title'
    const [p] = readEditableText(root, shape.text, SCALE, measure)
    expect(p.keep).toBeUndefined()
    expect(p.runs).toHaveLength(1)
    expect(p.runs[0].text).toBe('A new title')
    expect(p.runs[0].base).toBe(shape.text!.paragraphs[0].runs[0].rPr)
    expect(p.runs[0].format).toEqual({})
  })

  it('finds formatting the browser applied (bold, a size) by comparing with the run', () => {
    const shape = titleShape()
    const root = editor(shape)
    const span = root.querySelector<HTMLElement>('[data-r]')!
    const text = span.textContent!
    span.textContent = ''
    const bold = document.createElement('span')
    bold.style.fontWeight = '700'
    bold.style.fontSize = `${(40 * 12700 * SCALE).toFixed(2)}px`
    bold.textContent = text.slice(0, 4)
    span.append(bold, document.createTextNode(text.slice(4)))
    const [p] = readEditableText(root, shape.text, SCALE, measure)
    expect(p.runs[0]).toMatchObject({ text: text.slice(0, 4), format: { bold: true, size: 40 } })
    expect(p.runs[1]).toMatchObject({ text: text.slice(4), format: {} })
  })

  it('turns a split block into two paragraphs that both carry the source paragraph', () => {
    const shape = titleShape()
    const root = editor(shape)
    const block = root.firstElementChild as HTMLElement
    const second = block.cloneNode(true) as HTMLElement
    second.querySelector('[data-r]')!.textContent = 'Second line'
    root.append(second)
    const out = readEditableText(root, shape.text, SCALE, measure)
    expect(out).toHaveLength(2)
    expect(out[0].keep).toBe(true)
    expect(out[1].source).toBe(shape.text!.paragraphs[0].el)
    expect(out[1].runs[0].text).toBe('Second line')
  })

  it('reads an alignment set on a block', () => {
    const shape = titleShape()
    const root = editor(shape)
    ;(root.firstElementChild as HTMLElement).style.textAlign = 'right'
    const [p] = readEditableText(root, shape.text, SCALE, measure)
    expect(p.align).toBe('r')
    expect(p.keep).toBeUndefined()
  })

  it('treats the browser’s trailing <br> as a caret holder, an inner one as a line break', () => {
    const shape = titleShape()
    const root = editor(shape)
    const block = root.firstElementChild as HTMLElement
    const span = block.querySelector('[data-r]')!
    span.after(
      document.createElement('br'),
      document.createTextNode('after'),
      document.createElement('br')
    )
    const [p] = readEditableText(root, shape.text, SCALE, measure)
    expect(p.runs.map((r) => (r.br ? '<br>' : r.text))).toEqual([span.textContent, '<br>', 'after'])
  })
})
