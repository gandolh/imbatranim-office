// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useReplaceGate, type ReplaceLoad } from './useReplaceGate'

/**
 * Brief 143 — the gate every replace path (Open PDF, an intent from Files, a
 * drop) goes through. `react-dom/client` plus `act`, as in apps/core.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
/** What the harness exposes to the test, written after each commit. */
const probe: {
  requestReplace: (load: ReplaceLoad) => void
  setDirty: (dirty: boolean) => void
  dirty: boolean
} = { requestReplace: () => undefined, setDirty: () => undefined, dirty: false }
let events: string[]

/** What a document's save does: it clears `dirty` only when the bytes land. */
let saveSucceeds: boolean
const save = vi.fn(async () => {
  events.push('save')
  await Promise.resolve()
  if (saveSucceeds) probe.setDirty(false)
})
const load = vi.fn(async () => {
  events.push('load')
})

function Harness({ initiallyDirty }: { initiallyDirty: boolean }) {
  const [dirty, setDirty] = useState(initiallyDirty)
  const gate = useReplaceGate(dirty, 'contract.pdf', save)
  useEffect(() => {
    probe.requestReplace = gate.requestReplace
    probe.setDirty = setDirty
    probe.dirty = dirty
  }, [gate.requestReplace, dirty])
  return <>{gate.dialog}</>
}

async function mount(initiallyDirty: boolean) {
  await act(async () => {
    root.render(<Harness initiallyDirty={initiallyDirty} />)
  })
}

const dialogText = () => document.body.textContent ?? ''
const asking = () => dialogText().includes('Do you want to save changes to')

async function press(label: string) {
  const button = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  )
  if (!button) throw new Error(`no "${label}" button`)
  await act(async () => {
    button.click()
  })
  await act(async () => new Promise((r) => setTimeout(r, 0)))
}

async function ask() {
  await act(async () => {
    probe.requestReplace(load)
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  events = []
  saveSucceeds = true
  save.mockClear()
  load.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('replacing the open document', () => {
  it('a clean document is replaced with no question', async () => {
    await mount(false)
    await ask()
    expect(load).toHaveBeenCalledTimes(1)
    expect(asking()).toBe(false)
  })

  it('a dirty document asks; Cancel keeps it, still dirty', async () => {
    await mount(true)
    await ask()
    expect(asking()).toBe(true)
    expect(dialogText()).toContain('contract.pdf')

    await press('Cancel')
    expect(load).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(probe.dirty).toBe(true)
    expect(asking()).toBe(false)
  })

  it("Don't Save loads the new document", async () => {
    await mount(true)
    await ask()
    await press("Don't Save")
    expect(save).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('Save writes the current document first, then loads the new one', async () => {
    await mount(true)
    await ask()
    await press('Save')
    expect(events).toEqual(['save', 'load'])
  })

  it('a Save that fails keeps the current document', async () => {
    saveSucceeds = false
    await mount(true)
    await ask()
    await press('Save')
    expect(save).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
    expect(probe.dirty).toBe(true)
    expect(asking()).toBe(false)
  })
})
