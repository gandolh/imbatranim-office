import { describe, expect, it } from 'vitest'
import { fixture } from '../testing/fixtures'
import { insertShape, insertTextBox, setShapeBox } from '../engine/edits'
import { bytesEqual } from '../engine/opc'
import { readZip } from '../engine/zip'
import { DeckStore } from './store'

const box = { x: 100, y: 100, cx: 1000, cy: 1000 }

describe('the deck store', () => {
  it('is clean as opened, dirty after an action, clean again after undoing it', () => {
    const store = DeckStore.open(fixture('theme.pptx'))
    const part = store.slides()[0].part
    expect(store.dirty).toBe(false)
    store.act('Insert shape', () => insertShape(store.deck, part, 'rect', box))
    expect(store.dirty).toBe(true)
    expect(store.undoLabel).toBe('Insert shape')
    store.undo()
    expect(store.dirty).toBe(false)
    store.redo()
    expect(store.dirty).toBe(true)
  })

  it('knows which state reached the disk', () => {
    const store = DeckStore.open(fixture('theme.pptx'))
    const part = store.slides()[0].part
    const id = store.act('Insert shape', () => insertShape(store.deck, part, 'rect', box))
    const { token } = store.snapshot()
    store.act('Move', () =>
      setShapeBox(store.deck, part, id, { ...box, x: 5, rot: 0, flipH: false, flipV: false })
    )
    store.markSaved(token)
    // The move came after the bytes that were saved.
    expect(store.dirty).toBe(true)
    store.undo()
    expect(store.dirty).toBe(false)
  })

  it('gives back the original bytes of every part after undoing everything', () => {
    const original = fixture('anim.pptx')
    const store = DeckStore.open(original)
    const part = store.slides()[0].part
    store.act('a', () => insertShape(store.deck, part, 'rect', box))
    store.act('b', () => store.deck.addSlide(store.layouts()[1].part, 1))
    store.act('c', () => store.deck.deleteSlide(2))
    store.undo()
    store.undo()
    store.undo()
    const a = readZip(original).files
    const b = readZip(store.snapshot().bytes).files
    for (const [k, v] of a) expect(bytesEqual(v, b.get(k)!), k).toBe(true)
  })

  it('takes back a step without leaving it to redo (an empty text box)', () => {
    const store = DeckStore.open(fixture('theme.pptx'))
    const part = store.slides()[0].part
    store.act('Insert text box', () => insertTextBox(store.deck, part, box))
    expect(store.discard(store.stateToken)).toBe(true)
    expect(store.canRedo).toBe(false)
    expect(store.dirty).toBe(false)
  })

  it('puts every part back when an action throws', () => {
    const store = DeckStore.open(fixture('theme.pptx'))
    const before = store.slides().length
    expect(() =>
      store.act('Broken', () => {
        store.deck.addSlide(store.layouts()[0].part, 0)
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(store.slides()).toHaveLength(before)
    expect(store.canUndo).toBe(false)
  })

  it('reuses a slide’s model until a part it reads changes', () => {
    const store = DeckStore.open(fixture('theme.pptx'))
    const first = store.model(0)
    const second = store.model(1)
    store.act('Insert shape', () => insertShape(store.deck, store.slides()[0].part, 'rect', box))
    expect(store.model(1)).toBe(second)
    expect(store.model(0)).not.toBe(first)
  })
})
