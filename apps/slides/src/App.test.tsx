// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture } from './testing/fixtures'
import {
  cleanupRendered,
  clickButton,
  createFakeSystem,
  fakeHost,
  renderWithSystem,
  settle,
} from '@imbatranim-office/shared/testing'
import { App } from './App'
import { Deck } from './engine/deck'

/** jsdom has no ResizeObserver: report nothing, as a window that never resizes. */
class NoResize {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoResize)
})

afterEach(() => {
  cleanupRendered()
  vi.unstubAllGlobals()
})

const opened = { root: 'home', openPath: 'decks/anim.pptx' }

function press(label: string) {
  const el = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!el) throw new Error(`no "${label}" control`)
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function open(
  files: Record<string, Uint8Array | string> = { 'home:decks/anim.pptx': fixture('anim.pptx') },
  intent: unknown = opened
) {
  const fake = createFakeSystem({ appId: 'office-slides', files, intent: intent ?? undefined })
  const view = renderWithSystem(
    <App windowId="window-1" host={fakeHost({ appId: 'office-slides' })} />,
    fake.system
  )
  await settle()
  await settle()
  return { fake, view }
}

describe('Slides', () => {
  it('opens the presentation the window was opened with and draws it', async () => {
    const { fake, view } = await open()
    expect(fake.fsCalls).toEqual(['readWithVersion home:decks/anim.pptx'])
    expect(view.container.textContent).toContain('1 / 6')
    expect(view.container.querySelectorAll('[role=listbox] [role=option]')).toHaveLength(6)
    expect(view.container.querySelector('[role=application]')?.textContent).toContain(
      'Animated slide 1'
    )
    expect(fake.titles[fake.titles.length - 1]).toBe('anim.pptx')
  })

  it('refuses a .ppt by its name, without reading it', async () => {
    const { fake, view } = await open(
      { 'home:old/WithLinks.ppt': 'OLE' },
      { root: 'home', openPath: 'old/WithLinks.ppt' }
    )
    expect(fake.fsCalls).toEqual([])
    expect(view.container.textContent).toContain(
      'PowerPoint 97-2003 (.ppt) is not supported. Slides reads .pptx files.'
    )
    expect(fake.notifications[0]).toMatchObject({
      level: 'warning',
      title: 'Cannot open this file',
    })
  })

  it('refuses a .pptx that is not a presentation package', async () => {
    const { view } = await open(
      { 'home:decks/fake.pptx': 'just text' },
      { root: 'home', openPath: 'decks/fake.pptx' }
    )
    expect(view.container.textContent).toContain('This file is not a readable .pptx package.')
  })

  it('marks an edit dirty, saves over the file it read (sending its version) and is clean again', async () => {
    const { fake } = await open()
    press('Duplicate slide')
    await settle()
    expect(fake.titles[fake.titles.length - 1]).toBe('anim.pptx •')
    clickButton('Save')
    await settle()
    expect(fake.fsCalls).toContain('upload home:decks/anim.pptx')
    expect(fake.titles[fake.titles.length - 1]).toBe('anim.pptx')
    const saved = Deck.open(fake.files.get('home:decks/anim.pptx')!)
    expect(saved.slides()).toHaveLength(7)
  })

  it('asks before overwriting a file that changed on disk since it was read', async () => {
    const { fake } = await open()
    // Someone else saves the file.
    await fake.system.fs.upload('home', 'decks/anim.pptx', fixture('anim.pptx'), 'anim.pptx')
    press('Duplicate slide')
    clickButton('Save')
    await settle()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toMatch(/changed/i)
    clickButton('Cancel')
    await settle()
    expect(fake.titles[fake.titles.length - 1]).toBe('anim.pptx •')
  })

  it('guards closing while there are unsaved changes', async () => {
    const { fake } = await open()
    expect(await fake.closeGuard()!()).toBe(true)
    press('Delete slide')
    await settle()
    let answer: boolean | Promise<boolean> = false
    act(() => {
      answer = fake.closeGuard()!()
    })
    await settle()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('anim.pptx')
    clickButton("Don't Save")
    await settle()
    expect(await answer).toBe(true)
  })

  it('undoes and redoes a slide operation', async () => {
    const { view } = await open()
    press('Delete slide')
    await settle()
    expect(view.container.textContent).toContain('1 / 5')
    press('Undo delete slide')
    await settle()
    expect(view.container.textContent).toContain('1 / 6')
  })

  it('starts a new presentation from an empty window, untitled and unsaved', async () => {
    const { fake, view } = await open({}, null)
    expect(view.container.textContent).toContain('Nothing open')
    clickButton('New presentation')
    await settle()
    expect(view.container.textContent).toContain('1 / 1')
    expect(fake.titles[fake.titles.length - 1]).toBe('Untitled.pptx •')
  })

  it('shows and edits the speaker notes of the current slide', async () => {
    const { fake, view } = await open()
    press('Speaker notes')
    await settle()
    const area = view.container.querySelector('textarea')!
    expect(area.value).toContain('Speaker notes for slide 1')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(area, 'New note')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      area.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await settle()
    expect(fake.titles[fake.titles.length - 1]).toBe('anim.pptx •')
  })
})
