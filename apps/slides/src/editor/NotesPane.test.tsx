// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesPane } from './NotesPane'
import { normalizeNotes } from './notesText'

/**
 * The notes box keeps what is typed while its own commits come back from the
 * deck. Found in brief 07's walk: after a pause wrote the notes, the next key
 * was thrown away, so "ab", a pause, then " cd" left "abcd".
 */

let container: HTMLDivElement
let root: Root
const commits: string[] = []

/**
 * The editor's side: a commit is written to the deck and comes back
 * normalized. `undoTo` stands for the deck changing for another reason.
 */
function Harness({ initial, undoTo }: { initial: string; undoTo?: string }) {
  const [text, setText] = useState(initial)
  const [seenUndo, setSeenUndo] = useState(undoTo)
  if (undoTo !== seenUndo) {
    setSeenUndo(undoTo)
    if (undoTo !== undefined) setText(undoTo)
  }
  return (
    <NotesPane
      slideNumber={1}
      text={text}
      onCommit={(value) => {
        commits.push(value)
        setText(normalizeNotes(value))
      }}
    />
  )
}

const area = () => container.querySelector('textarea')!

/** Type one key at the end, as the browser does: the value changes, then input fires. */
function typeKey(key: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(area(), area().value + key)
    area().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function pause(ms = 1000) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  commits.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('NotesPane', () => {
  it('keeps the first key typed after a pause wrote the notes', () => {
    act(() => root.render(<Harness initial="" />))
    typeKey('a')
    typeKey('b')
    pause()
    expect(commits).toEqual(['ab'])
    typeKey(' ')
    expect(area().value).toBe('ab ')
    typeKey('c')
    typeKey('d')
    pause()
    expect(area().value).toBe('ab cd')
    expect(commits).toEqual(['ab', 'ab cd'])
  })

  it('keeps typing across several pauses', () => {
    act(() => root.render(<Harness initial="Note" />))
    for (const word of [' one', ' two', ' three']) {
      for (const key of word) typeKey(key)
      pause()
    }
    expect(area().value).toBe('Note one two three')
    expect(commits[commits.length - 1]).toBe('Note one two three')
  })

  it('keeps trailing blank lines in the box while the deck drops them', () => {
    act(() => root.render(<Harness initial="" />))
    for (const key of 'line\n\n') typeKey(key)
    pause()
    expect(commits).toEqual(['line\n\n'])
    expect(area().value).toBe('line\n\n')
    typeKey('x')
    expect(area().value).toBe('line\n\nx')
  })

  it('shows what the deck holds when it changes for another reason (an undo)', () => {
    act(() => root.render(<Harness initial="" />))
    typeKey('a')
    pause()
    act(() => root.render(<Harness initial="" undoTo="Restored by undo" />))
    expect(area().value).toBe('Restored by undo')
    typeKey('!')
    expect(area().value).toBe('Restored by undo!')
  })
})
