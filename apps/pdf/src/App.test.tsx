// @vitest-environment jsdom
import { act } from 'react'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { SystemHandle } from '@imbatranim/ui'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
 * pdf.js, at the reader's boundary (reader/pdfjs.ts): jsdom has no worker and
 * no canvas, and what is under test here is the app around the renderer, the
 * way the desktop renders it. The fake measures pages with pdf-lib and records
 * every draw. The engine (`@pdfcore/engine`: pdf-lib for writes, pdf.js's
 * Node build for text and outline) is the real one, loaded through
 * app/engine.ts, which the spy below wraps to see when it is asked for.
 */
const events = vi.hoisted(() => ({ log: [] as string[], disposed: 0 }))

vi.mock('./reader/pdfjs', async () => {
  const { PDFDocument } = await import('pdf-lib')
  const sizesOf = async (bytes: Uint8Array) =>
    (await PDFDocument.load(bytes, { updateMetadata: false }))
      .getPages()
      .map((p) => ({ w: p.getWidth(), h: p.getHeight() }))

  class PageRender {
    readonly bytes: Uint8Array
    constructor(bytes: Uint8Array) {
      this.bytes = bytes
    }
    async pageCount() {
      return (await sizesOf(this.bytes)).length
    }
    async viewport(page: number, opts?: { scale?: number }) {
      const s = (await sizesOf(this.bytes))[page - 1]!
      const scale = opts?.scale ?? 1
      return {
        width: s.w * scale,
        height: s.h * scale,
        pageWidth: s.w,
        pageHeight: s.h,
        scale,
        rotation: 0,
      }
    }
    async page(page: number, target: { width: number; height: number }, opts?: { scale?: number }) {
      const s = (await sizesOf(this.bytes))[page - 1]!
      target.width = Math.ceil(s.w * (opts?.scale ?? 1))
      target.height = Math.ceil(s.h * (opts?.scale ?? 1))
      events.log.push(`draw ${page}`)
      return { width: target.width, height: target.height }
    }
    async pageSizes() {
      return sizesOf(this.bytes)
    }
    dispose() {
      events.disposed += 1
    }
  }

  return {
    PageRender,
    warmUpPdfjs: async () => {
      events.log.push('warm up')
      return {}
    },
    async openFirstPage(bytes: Uint8Array) {
      const sizes = await sizesOf(bytes)
      events.log.push('pdf.js open')
      return { render: new PageRender(bytes), pageCount: sizes.length, size: sizes[0] }
    },
    readerPlatform: (first: PageRender) => ({
      name: 'browser',
      createRender: (bytes: Uint8Array) => (bytes === first.bytes ? first : new PageRender(bytes)),
    }),
  }
})

// The engine's browser entry imports pdf.js's GlobalWorkerOptions, and pdf.js's
// browser build needs DOMMatrix, which jsdom lacks: its Node build (the one
// the engine's own `#pdfjs` picks under Vitest) stands in.
vi.mock('pdfjs-dist', () => import('pdfjs-dist/legacy/build/pdf.mjs'))

vi.mock('./app/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('./app/engine')>()
  return {
    ...real,
    loadEngine: () => {
      events.log.push('engine')
      return real.loadEngine()
    },
  }
})

/** A small PDF with text on every page and two form fields, one already filled. */
async function pdfBytes(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Fixture report')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([612, 792])
    page.drawText(`Page ${i} of the quarterly report`, { x: 72, y: 700, size: 14, font })
  }
  const form = doc.getForm()
  const name = form.createTextField('applicant')
  name.addToPage(doc.getPage(0), { x: 72, y: 600, width: 200, height: 20 })
  const city = form.createTextField('city')
  city.setText('Timisoara')
  city.addToPage(doc.getPage(0), { x: 72, y: 560, width: 200, height: 20 })
  return new Uint8Array(await doc.save())
}

const PATH = 'Documents/report.pdf'
const opened = { root: 'home', openPath: PATH }

beforeAll(() => {
  // jsdom lays nothing out: give the reader a window-sized viewport.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      cb: (entries: { isIntersecting: boolean }[]) => void
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        this.cb = cb
      }
      observe() {
        this.cb([{ isIntersecting: true }])
      }
      disconnect() {}
    }
  )
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 500,
  })
  // jsdom has no scrolling: keep the positions, so the reader can read them back.
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, opts?: ScrollToOptions | number) {
    if (typeof opts === 'object') this.scrollTop = opts.top ?? this.scrollTop
  } as HTMLElement['scrollTo']
  HTMLElement.prototype.scrollBy = function (this: HTMLElement, opts?: ScrollToOptions | number) {
    if (typeof opts === 'object') this.scrollTop += opts.top ?? 0
  } as HTMLElement['scrollBy']
  HTMLElement.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  events.log = []
  events.disposed = 0
})

afterEach(() => {
  cleanupRendered()
  vi.restoreAllMocks()
})

/** Settle until `ready()` holds: file reads, pdf.js, the engine's chunk and its parse are all async. */
async function until(ready: () => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (ready()) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Read, parse, draw, then wait for the engine, which loads after the first paint. */
async function openDocument() {
  await until(() => {
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')
    return !!search && !search.disabled
  }, 'the engine')
  await settle()
}

/** Show the Forms tab and wait for its fields. */
async function openForms(count: number): Promise<HTMLInputElement[]> {
  act(() => {
    ;[...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((t) => t.textContent?.includes('Forms'))!
      .click()
  })
  const inputs = () => [...document.querySelectorAll<HTMLInputElement>('[role="tabpanel"] input')]
  await until(() => inputs().length >= count, 'the form fields')
  return inputs()
}

function press(key: string, ctrlKey = true) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true }))
  })
}

function buttonLabelled(label: string): HTMLButtonElement {
  const b = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!b) throw new Error(`no button labelled "${label}"`)
  return b
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
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

describe('PDF, as a kit app', () => {
  it('draws the first page with pdf.js alone, and loads the engine only after it', async () => {
    const fake = createFakeSystem({
      appId: 'office-pdf',
      files: { [`home:${PATH}`]: await pdfBytes() },
      intent: opened,
    })
    const view = renderWithSystem(
      <App windowId="window-1" host={fakeHost({ appId: 'office-pdf' })} />,
      fake.system
    )
    await openDocument()

    expect(fake.fsCalls).toEqual([`readWithVersion home:${PATH}`])
    const firstDraw = events.log.indexOf('draw 1')
    expect(firstDraw).toBeGreaterThan(events.log.indexOf('pdf.js open'))
    expect(events.log.indexOf('engine')).toBeGreaterThan(firstDraw)
    expect(fake.titles.at(-1)).toBe('report.pdf')
    expect(view.container.textContent).toContain('/ 3')
    // The engine is in: search and the text layer work, Save waits for an edit.
    const search = view.container.querySelector<HTMLInputElement>('input[type="search"]')!
    expect(search.disabled).toBe(false)
    expect(view.container.querySelector('.pdfcore-text-layer span')?.textContent).toContain(
      'Page 1 of the quarterly report'
    )
    const save = [...view.container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Save'
    )
    expect(save?.disabled).toBe(true)
  })

  it('starts pdf.js while the file is still being read', async () => {
    const fake = createFakeSystem({
      appId: 'office-pdf',
      files: { [`home:${PATH}`]: await pdfBytes() },
      intent: opened,
    })
    // Hold the read open: brief 09's walk found pdf.js waiting for the bytes.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const read = fake.system.fs.readWithVersion.bind(fake.system.fs)
    fake.system.fs.readWithVersion = async (root, path) => {
      events.log.push('read')
      await held
      return read(root, path)
    }
    renderWithSystem(
      <App windowId="window-1" host={fakeHost({ appId: 'office-pdf' })} />,
      fake.system
    )
    await settle()
    expect(events.log).toContain('read')
    expect(events.log).toContain('warm up')
    expect(events.log).not.toContain('pdf.js open')
    release()
    await openDocument()
    expect(events.log.indexOf('pdf.js open')).toBeGreaterThan(events.log.indexOf('warm up'))
  })

  it('writes nothing for Ctrl+S on an untouched document', async () => {
    const fake = createFakeSystem({ files: { [`home:${PATH}`]: await pdfBytes() }, intent: opened })
    const before = new Uint8Array(fake.files.get(`home:${PATH}`)!)
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()
    press('s')
    await settle()
    expect(fake.fsCalls).toEqual([`readWithVersion home:${PATH}`])
    expect(fake.files.get(`home:${PATH}`)).toEqual(before)
  })

  it('fills a form field and saves over the file with the version it read; the other field keeps its value', async () => {
    const fake = createFakeSystem({ files: { [`home:${PATH}`]: await pdfBytes() }, intent: opened })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()

    const inputs = await openForms(2)
    expect(inputs).toHaveLength(2)
    type(inputs[0]!, 'Jane Q. Public')
    expect(fake.titles.at(-1)).toBe('report.pdf •')

    const upload = vi.spyOn(fake.system.fs, 'upload')
    press('s')
    await until(() => fake.titles.at(-1) === 'report.pdf', 'the save')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0]!.slice(0, 2)).toEqual(['home', PATH])
    expect(upload.mock.calls[0]![4]).toEqual({ expected: 'v1' })
    expect(fake.titles.at(-1)).toBe('report.pdf')

    const saved = await PDFDocument.load(fake.files.get(`home:${PATH}`)!)
    const form = saved.getForm()
    expect(form.getTextField('applicant').getText()).toBe('Jane Q. Public')
    expect(form.getTextField('city').getText()).toBe('Timisoara')
    expect(saved.getPageCount()).toBe(3)
    expect(saved.getTitle()).toBe('Fixture report')
  })

  it('asks before saving over a file that changed on disk, and Cancel writes nothing', async () => {
    const fake = createFakeSystem({ files: { [`home:${PATH}`]: await pdfBytes() }, intent: opened })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()
    type((await openForms(2))[0]!, 'Mine')
    // Someone else saves the file after PDF read it.
    const theirs = new TextEncoder().encode('theirs')
    await fake.system.fs.upload('home', PATH, theirs, 'report.pdf')

    press('s')
    await until(() => !!document.querySelector('[role="dialog"]'), 'the conflict dialog')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'changed on disk since you opened it'
    )
    clickButton('Cancel')
    await settle()
    expect(new TextDecoder().decode(fake.files.get(`home:${PATH}`))).toBe('theirs')
    expect(fake.titles.at(-1)).toBe('report.pdf •')
  })

  it("offers its own Open button that uses the OS's dialog, never a file input", async () => {
    const fake = createFakeSystem()
    const pickOpen = vi.spyOn(fake.system.fs, 'pickOpen')
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    expect(view.container.textContent).toContain('Open a PDF')
    clickButton('Open a PDF')
    await settle()
    expect(pickOpen).toHaveBeenCalledWith({ extensions: ['pdf'] })
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('steps zoom by 25% as PDF Viewer did, with the buttons and with + and -', async () => {
    const fake = createFakeSystem({ files: { [`home:${PATH}`]: await pdfBytes() }, intent: opened })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()
    const label = () => view.container.querySelector('[aria-live="polite"]')!.textContent
    // Fit width: (800 - 64) px over a 612 pt page at 96/72 px per pt.
    expect(label()).toBe('90%')
    act(() => buttonLabelled('Zoom in (+)').click())
    expect(label()).toBe('100%')
    press('+', false)
    expect(label()).toBe('125%')
    press('-', false)
    expect(label()).toBe('100%')
    act(() => buttonLabelled('Zoom out (−)').click())
    expect(label()).toBe('75%')
    act(() => buttonLabelled('Fit width').click())
    expect(label()).toBe('90%')
  })

  it('releases the pdf.js document when the window closes', async () => {
    const fake = createFakeSystem({ files: { [`home:${PATH}`]: await pdfBytes() }, intent: opened })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openDocument()
    const before = events.disposed
    view.unmount()
    expect(events.disposed).toBeGreaterThan(before)
  })

  it('uses fs, intents and notify from the handle, and never shortcuts, http or schedule', async () => {
    const fake = createFakeSystem({ files: { [`home:${PATH}`]: await pdfBytes() }, intent: opened })
    const recorded = recordingHandle(fake.system)
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, recorded.system)
    await openDocument()
    type((await openForms(2))[0]!, 'x')
    press('f')
    press('s')
    await until(() => recorded.used.has('notify'), 'the save notification')
    // What the desktop's scoped handle always grants (OS scopeHandle's ALWAYS).
    const always = ['protocolVersion', 'appId', 'windowId', 'window', 'appearance', 'on']
    const capabilities = [...recorded.used].filter((p) => !always.includes(p)).sort()
    expect(capabilities).toEqual(['fs', 'intents', 'notify'])
  })
})
