/**
 * The test decks, for tests only (nothing in the app imports this). All
 * three are generated test files: two CC0 decks made with python-pptx for
 * this suite (an animated one with notes, one with a custom theme), and the
 * OS viewer's own notes fixture (notes on slides 1, 2, 4 and 5).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type FixtureName = 'anim.pptx' | 'notes.pptx' | 'theme.pptx'

/** A fresh copy of a fixture's bytes. */
export function fixture(name: FixtureName): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', name)))
}
