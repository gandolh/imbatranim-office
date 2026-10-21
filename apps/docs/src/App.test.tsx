// @vitest-environment jsdom
import { act } from 'react'
import { strToU8, zipSync } from 'fflate'
import type { SystemHandle } from '@imbatranim/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupRendered,
  clickButton,
  createFakeSystem,
  fakeHost,
  renderWithSystem,
  settle,
} from '@imbatranim-office/shared/testing'
import { App } from './App'

/**
 * SuperDoc, at the module boundary: jsdom cannot lay out a document, and what
 * is under test here is Docs around the engine, the way the desktop renders it.
 * The fake keeps the options it was built with and answers the calls
 * engine/superdoc.ts makes.
 */
const engine = vi.hoisted(() => ({
  instances: [] as {
    options: Record<string, unknown> & {
      selector: HTMLElement
      toolbar: string
      document: File
      onReady: () => void
      onEditorUpdate: () => void
    }
    destroyed: boolean
  }[],
  text: 'Hello brave new world, hello again',
  exported: 'edited bytes',
}))

vi.mock('@harbour-enterprises/superdoc', () => {
  class SuperDoc {
    options: (typeof engine.instances)[number]['options']
    destroyed = false
    constructor(options: (typeof engine.instances)[number]['options']) {
      this.options = options
      engine.instances.push(this)
      setTimeout(() => options.onReady(), 0)
    }
    async export() {
      // What engine/superdoc.ts reads off the Blob SuperDoc returns (jsdom's has no arrayBuffer).
      return { arrayBuffer: async () => new TextEncoder().encode(engine.exported).buffer }
    }
    search(pattern: RegExp) {
      return [...engine.text.matchAll(pattern)].map((m) => ({ index: m.index }))
    }
    goToSearchResult() {}
    getHTML() {
      return [`<p>${engine.text}</p>`]
    }
    destroy() {
      this.destroyed = true
    }
  }
  return { SuperDoc }
})

// jsdom's TextEncoder hands back another realm's Uint8Array, which fflate's
// zipSync would read as a folder: copy into this realm's first.
const u8 = (text: string) => new Uint8Array(strToU8(text))

/** A small, complete docx: every part the normalizer checks is present. */
function docxBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': u8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
    ),
    '_rels/.rels': u8('<?xml version="1.0"?><Relationships/>'),
    'word/document.xml': u8('<?xml version="1.0"?><w:document/>'),
    'word/styles.xml': u8('<?xml version="1.0"?><w:styles/>'),
    'word/_rels/document.xml.rels': u8('<?xml version="1.0"?><Relationships/>'),
    'docProps/custom.xml': u8('<?xml version="1.0"?><Properties/>'),
  })
}

const opened = { root: 'home', openPath: 'Documents/report.docx' }

beforeEach(() => {
  engine.instances = []
})

afterEach(() => {
  cleanupRendered()
  vi.restoreAllMocks()
})

/** Read the file, normalize it, load the engine, and let it say it is ready. */
async function openDocument() {
  for (let i = 0; i < 4; i++) await settle()
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }))
  })
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(target: Element, name: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
  })
}

/** Record every top-level member of the handle the app reaches for: its capabilities. */
function recordingHandle(system: SystemHandle): { system: SystemHandle; used: Set<string> } {
  const used = new Set<string>()
  const proxy = new Proxy(system, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') used.add(prop)
      return Reflect.get(target, prop, receiver) as unknown
    },
  })
  return { system: proxy, used }
}

describe('Docs, as a kit app', () => {
  it('opens the .docx the window was opened with, in SuperDoc mounted inside the window', async () => {
    const fake = createFakeSystem({
      appId: 'office-docs',
      files: { 'home:Documents/report.docx': docxBytes() },
      intent: opened,
    })
    const view = renderWithSystem(
      <App windowId="window-1" host={fakeHost({ appId: 'office-docs' })} />,
      fake.system
    )
    await openDocument()

    expect(fake.fsCalls).toEqual(['readWithVersion home:Documents/report.docx'])
    expect(engine.instances).toHaveLength(1)
    const { options } = engine.instances[0]
    expect(options.document.name).toBe('report.docx')
    expect(options.document.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(options).toMatchObject({ documentMode: 'editing', telemetry: { enabled: false } })
    // Editor and toolbar both mount inside this window's own tree.
    expect(view.container.contains(options.selector)).toBe(true)
    expect(options.toolbar).toMatch(/^#docs-toolbar-window-1-/)
    expect(view.container.contains(document.querySelector(options.toolbar))).toBe(true)

    expect(view.container.textContent).not.toContain('Loading document…')
    expect(view.container.textContent).toContain('6 words')
    expect(fake.titles.at(-1)).toBe('report.docx')
    const save = [...view.container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Save'
    )
    expect(save?.disabled).toBe(true)
  })

  it('refuses other word formats by name before reading, and points .pdf at PDF', async () => {
    const cases = [
      ['old.doc', 'Word 97-2003 (.doc) is not supported. Docs reads .docx files.'],
      ['notes.odt', 'OpenDocument Text (.odt) is not supported. Docs reads .docx files.'],
      ['memo.rtf', 'Rich Text Format (.rtf) is not supported. Docs reads .docx files.'],
      ['scan.pdf', '.pdf files open in PDF. Docs reads .docx files.'],
    ] as const
    for (const [name, reason] of cases) {
      const fake = createFakeSystem({
        files: { [`home:Documents/${name}`]: 'not a docx' },
        intent: { root: 'home', openPath: `Documents/${name}` },
      })
      const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
      await openDocument()
      expect(view.container.textContent, name).toContain(reason)
      expect(view.container.textContent).toContain('Open a .docx instead')
      expect(fake.fsCalls, name).toEqual([])
      expect(fake.notifications).toEqual([
        { title: 'Cannot open this file', body: `${name} — ${reason}`, level: 'warning' },
      ])
      expect(engine.instances).toHaveLength(0)
      cleanupRendered()
    }
  })

  it('offers its own Open button when the window was opened without a file', async () => {
    const fake = createFakeSystem()
    const pickOpen = vi.spyOn(fake.system.fs, 'pickOpen')
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    expect(view.container.textContent).toContain('Nothing open')
    clickButton('Open a document')
    await settle()
    expect(pickOpen).toHaveBeenCalledWith({ extensions: ['docx'] })
    expect(fake.fsCalls).toEqual([])
  })

  it('marks an edit dirty, and Ctrl+S saves over the file it read, with the version it read', async () => {
    const fake = createFakeSystem({
      files: { 'home:Documents/report.docx': docxBytes() },
      intent: opened,
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()

    act(() => engine.instances[0].options.onEditorUpdate())
    expect(fake.titles.at(-1)).toBe('report.docx •')

    const upload = vi.spyOn(fake.system.fs, 'upload')
    press('s')
    await settle()
    await settle()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0].slice(0, 2)).toEqual(['home', 'Documents/report.docx'])
    expect(upload.mock.calls[0][4]).toEqual({ expected: 'v1' })
    expect(new TextDecoder().decode(fake.files.get('home:Documents/report.docx'))).toBe(
      'edited bytes'
    )
    expect(fake.titles.at(-1)).toBe('report.docx')
  })

  it('asks before saving over a file that changed on disk, and Cancel writes nothing', async () => {
    const fake = createFakeSystem({
      files: { 'home:Documents/report.docx': docxBytes() },
      intent: opened,
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()
    act(() => engine.instances[0].options.onEditorUpdate())
    // Someone else saves the file after Docs read it.
    await fake.system.fs.upload('home', 'Documents/report.docx', u8('theirs'), 'report.docx')

    press('s')
    await settle()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'changed on disk since you opened it'
    )
    clickButton('Cancel')
    await settle()
    expect(new TextDecoder().decode(fake.files.get('home:Documents/report.docx'))).toBe('theirs')
    expect(fake.titles.at(-1)).toBe('report.docx •')
  })

  it('opens the find bar on Ctrl+F, steps through matches with wrap, and closes on Escape', async () => {
    const fake = createFakeSystem({
      files: { 'home:Documents/report.docx': docxBytes() },
      intent: opened,
    })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()

    press('f')
    const input = view.container.querySelector<HTMLInputElement>(
      'input[aria-label="Find in document"]'
    )
    expect(input).not.toBeNull()
    type(input!, 'hello')
    expect(view.container.textContent).toContain('1 of 2')
    key(input!, 'Enter')
    expect(view.container.textContent).toContain('2 of 2')
    key(input!, 'Enter')
    expect(view.container.textContent).toContain('1 of 2')
    key(input!, 'Escape')
    expect(view.container.querySelector('input[aria-label="Find in document"]')).toBeNull()
  })

  it('tears SuperDoc down when the window closes', async () => {
    const fake = createFakeSystem({
      files: { 'home:Documents/report.docx': docxBytes() },
      intent: opened,
    })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()
    view.unmount()
    expect(engine.instances[0].destroyed).toBe(true)
  })

  it('uses fs, intents and notify from the handle, and never shortcuts, http or schedule', async () => {
    const fake = createFakeSystem({
      files: { 'home:Documents/report.docx': docxBytes() },
      intent: opened,
    })
    const recorded = recordingHandle(fake.system)
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, recorded.system)
    await openDocument()
    act(() => engine.instances[0].options.onEditorUpdate())
    press('f')
    press('s')
    await settle()
    await settle()
    cleanupRendered()
    // A refusal is what calls notify.
    const refused = createFakeSystem({ intent: { root: 'home', openPath: 'Documents/old.doc' } })
    const recordedRefusal = recordingHandle(refused.system)
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, recordedRefusal.system)
    await settle()

    const used = new Set([...recorded.used, ...recordedRefusal.used])
    // What the desktop's scoped handle always grants (OS scopeHandle's ALWAYS).
    const always = ['protocolVersion', 'appId', 'windowId', 'window', 'appearance', 'on']
    const capabilities = [...used].filter((p) => !always.includes(p)).sort()
    expect(capabilities).toEqual(['fs', 'intents', 'notify'])
  })
})
