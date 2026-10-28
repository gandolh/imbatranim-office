// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { act } from 'react'
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
import { readDxf } from './engine/dxf/read'

const APARTMENT = readFileSync(join(import.meta.dirname, '../fixtures/apartment.dxf'))

/** A small DXF written by hand: two lines on layer WALLS, R12 style (no handles). */
const SMALL_DXF = [
  '0',
  'SECTION',
  '2',
  'TABLES',
  '0',
  'TABLE',
  '2',
  'LAYER',
  '70',
  '1',
  '0',
  'LAYER',
  '2',
  'WALLS',
  '70',
  '0',
  '62',
  '1',
  '6',
  'CONTINUOUS',
  '0',
  'ENDTAB',
  '0',
  'ENDSEC',
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'LINE',
  '8',
  'WALLS',
  '10',
  '0',
  '20',
  '0',
  '30',
  '0',
  '11',
  '10',
  '21',
  '0',
  '31',
  '0',
  '0',
  'LINE',
  '8',
  'WALLS',
  '10',
  '10',
  '20',
  '0',
  '30',
  '0',
  '11',
  '10',
  '21',
  '8',
  '31',
  '0',
  '0',
  'ENDSEC',
  '0',
  'EOF',
  '',
].join('\n')

const ONE_CIRCLE = [
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'CIRCLE',
  '8',
  '0',
  '10',
  '0',
  '20',
  '0',
  '30',
  '0',
  '40',
  '2',
  '0',
  'ENDSEC',
  '0',
  'EOF',
  '',
].join('\n')

function clickButtonByLabel(label: string) {
  const b = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!b) throw new Error(`no "${label}" button`)
  act(() => b.click())
}

function commandInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Command line"]')
  if (!input) throw new Error('no command line')
  return input
}

/** Type a line into the command line and press Enter, as a user would. */
function typeLine(text: string) {
  const input = commandInput()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

/** Let async work (a dynamic import, a worker job) finish, up to a few seconds. */
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15))
    })
  }
}

function promptText(): string {
  return document.querySelector('[data-testid="cad-command-line"]')?.textContent ?? ''
}

beforeEach(() => {
  // jsdom has no canvas: the viewport draws nothing, everything else runs.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanupRendered()
  vi.restoreAllMocks()
})

describe('CAD App', () => {
  it('opens the .dxf it was launched with and shows its name', async () => {
    const fake = createFakeSystem({
      appId: 'office-cad',
      files: { 'home:Drawings/plan.dxf': SMALL_DXF },
      intent: { root: 'home', openPath: 'Drawings/plan.dxf' },
    })
    const view = renderWithSystem(
      <App windowId="window-1" host={fakeHost({ appId: 'office-cad' })} />,
      fake.system
    )
    await settle()
    expect(fake.fsCalls).toEqual(['readWithVersion home:Drawings/plan.dxf'])
    expect(view.container.querySelector('[data-testid="cad-file-name"]')?.textContent).toBe(
      'plan.dxf'
    )
    expect(fake.titles.at(-1)).toBe('plan.dxf')
    expect(fake.recents).toContain('home:Drawings/plan.dxf')
    expect(promptText()).toContain('Command:')
  })

  it('opens apartment.dxf and says which objects it keeps as drawn', async () => {
    const fake = createFakeSystem({
      files: { 'home:apartment.dxf': APARTMENT },
      intent: { root: 'home', openPath: 'apartment.dxf' },
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    // The history shows the last lines; the note is among them.
    const text = promptText()
    expect(text).toContain('Shown as drawn, not editable here yet')
    for (const part of ['7 dimensions', '5 hatches', '1 leader', '1 table'])
      expect(text).toContain(part)
  })

  it('draws with typed coordinates, marks the window dirty and saves over the file it read', async () => {
    const fake = createFakeSystem({
      files: { 'home:Drawings/plan.dxf': SMALL_DXF },
      intent: { root: 'home', openPath: 'Drawings/plan.dxf' },
    })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    typeLine('L')
    expect(promptText()).toContain('Specify first point:')
    typeLine('0,0')
    typeLine('@4,0')
    typeLine('@3<90')
    typeLine('')
    expect(view.container.querySelector('[data-testid="cad-file-name"]')?.textContent).toBe(
      'plan.dxf •'
    )
    expect(fake.titles.at(-1)).toBe('plan.dxf •')
    // Closing now asks first.
    expect(fake.closeGuard()).not.toBeNull()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    })
    await settle()
    expect(fake.fsCalls).toContain('upload home:Drawings/plan.dxf')
    const saved = readDxf(fake.files.get('home:Drawings/plan.dxf')!).doc
    const lines = saved.all().filter((e) => e.kind === 'line')
    expect(lines).toHaveLength(4)
    expect(lines[3].kind === 'line' && lines[3].b).toEqual({ x: 4, y: 3 })
    expect(saved.layers.get('WALLS')?.color).toBe(1)
    expect(view.container.querySelector('[data-testid="cad-file-name"]')?.textContent).toBe(
      'plan.dxf'
    )
  })

  it('asks before overwriting a file that changed on disk', async () => {
    const fake = createFakeSystem({
      files: { 'home:plan.dxf': SMALL_DXF },
      intent: { root: 'home', openPath: 'plan.dxf' },
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    typeLine('C')
    typeLine('5,5')
    typeLine('2')
    // Someone else saves the file meanwhile.
    await fake.system.fs.upload('home', 'plan.dxf', new TextEncoder().encode(SMALL_DXF), 'plan.dxf')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    })
    await settle()
    expect(document.body.textContent).toMatch(/changed/i)
    clickButton('Overwrite')
    await settle()
    const saved = readDxf(fake.files.get('home:plan.dxf')!).doc
    expect(saved.all().some((e) => e.kind === 'circle')).toBe(true)
  })

  it('after Save as, Reload from disk reads the file saved to, not the one launched with', async () => {
    const fake = createFakeSystem({
      files: { 'home:a.dxf': SMALL_DXF },
      intent: { root: 'home', openPath: 'a.dxf' },
    })
    fake.system.fs.pickSave = async () => ({ root: 'home', path: 'b.dxf' })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    clickButtonByLabel('Save as…')
    await until(() => fake.files.has('home:b.dxf'))
    // Someone else replaces b.dxf with one circle; our edit then meets the conflict.
    await fake.system.fs.upload('home', 'b.dxf', new TextEncoder().encode(ONE_CIRCLE), 'b.dxf')
    typeLine('L')
    typeLine('0,0')
    typeLine('1,1')
    typeLine('')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    })
    await settle()
    clickButton('Reload from disk')
    await until(
      () => (document.querySelector('[data-testid="cad-file-name"]')?.textContent ?? '') === 'b.dxf'
    )
    await settle()
    expect(fake.fsCalls.filter((c) => c.startsWith('readWithVersion')).at(-1)).toBe(
      'readWithVersion home:b.dxf'
    )
  })

  it('starts an untitled drawing without a file, and Save asks where (Save as)', async () => {
    const fake = createFakeSystem()
    fake.system.fs.pickSave = async () => ({ root: 'home', path: 'Drawings/room' })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    expect(view.container.querySelector('[data-testid="cad-file-name"]')?.textContent).toBe(
      'Drawing1.dxf'
    )
    typeLine('REC')
    typeLine('0,0')
    typeLine('@10,8')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    })
    await settle()
    await settle()
    expect(fake.files.has('home:Drawings/room.dxf')).toBe(true)
    expect(view.container.querySelector('[data-testid="cad-file-name"]')?.textContent).toBe(
      'room.dxf'
    )
    const saved = readDxf(fake.files.get('home:Drawings/room.dxf')!).doc
    expect(saved.all().map((e) => e.kind)).toEqual(['polyline'])
  })

  it('exports SVG and PDF through the save dialog', async () => {
    const fake = createFakeSystem({
      files: { 'home:plan.dxf': SMALL_DXF },
      intent: { root: 'home', openPath: 'plan.dxf' },
    })
    let ask = 'out/plan.svg'
    fake.system.fs.pickSave = async () => ({ root: 'home', path: ask })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Export as SVG…"]')!.click()
    })
    await until(() => fake.files.has('home:out/plan.svg'))
    const svg = new TextDecoder().decode(fake.files.get('home:out/plan.svg'))
    expect(svg).toContain('<svg')
    expect(svg).toContain('data-layer="WALLS"')
    ask = 'out/plan.pdf'
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Export as PDF…"]')!.click()
    })
    await until(() => fake.files.has('home:out/plan.pdf'))
    const pdf = fake.files.get('home:out/plan.pdf')
    expect(pdf && new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-')
    expect(fake.notifications.filter((n) => n.title === 'Exported')).toHaveLength(2)
  })

  it('opens the Layers dialog from LA and creates a layer', async () => {
    const fake = createFakeSystem()
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    typeLine('LA')
    await settle()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Layers')
    clickButton('New layer')
    await settle()
    // The prompt opens as a second dialog over the layer table.
    const dialogs = document.querySelectorAll('[role="dialog"]')
    const nameInput = dialogs[dialogs.length - 1].querySelector<HTMLInputElement>(
      'input:not([type="radio"]):not([type="checkbox"])'
    )!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(nameInput, 'WALLS')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    clickButton('Create')
    await settle()
    const rows = [...document.querySelectorAll('[role="dialog"] [role="listitem"]')].map(
      (r) => r.textContent
    )
    expect(rows.some((t) => t?.includes('WALLS'))).toBe(true)
  })
})

/**
 * The suite server's WebSocket as CAD sees it (brief 14): `reply` decides
 * what comes back for the DWG that was sent.
 */
type Reply = { binary?: Uint8Array; text?: string; code: number }
function stubServer(reply: (dwg: Uint8Array) => Reply) {
  const opened: string[] = []
  class FakeWebSocket {
    binaryType = 'blob'
    onopen: (() => void) | null = null
    onmessage: ((e: { data: unknown }) => void) | null = null
    onclose: ((e: { code: number }) => void) | null = null
    constructor(url: string) {
      opened.push(url)
      setTimeout(() => this.onopen?.(), 0)
    }
    send(data: ArrayBuffer) {
      const r = reply(new Uint8Array(data))
      setTimeout(() => {
        if (r.binary) {
          const copy = new Uint8Array(r.binary)
          this.onmessage?.({ data: copy.buffer })
        }
        if (r.text) this.onmessage?.({ data: r.text })
        this.onclose?.({ code: r.code })
      }, 0)
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket)
  return opened
}

const SERVER = {
  http: 'http://localhost/api/marketplace/apps/imbatranim-office/server',
  ws: 'ws://localhost/api/marketplace/apps/imbatranim-office/server',
}
const DWG = 'AC1032 a drawing the server converts'

describe('CAD App with DWG', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('opens a DWG through the server, titled with the DWG’s name', async () => {
    const sent: string[] = []
    const opened = stubServer((dwg) => {
      sent.push(new TextDecoder().decode(dwg))
      return { binary: gzipSync(SMALL_DXF), code: 1000 }
    })
    const fake = createFakeSystem({
      files: { 'home:Drawings/plan.dwg': DWG },
      intent: { root: 'home', openPath: 'Drawings/plan.dwg' },
    })
    const view = renderWithSystem(
      <App windowId="window-1" host={fakeHost({ server: SERVER })} />,
      fake.system
    )
    await until(() => promptText().includes('Converted from DWG'))
    expect(opened).toEqual([`${SERVER.ws}/dwg-to-dxf`])
    expect(sent).toEqual([DWG])
    expect(view.container.querySelector('[data-testid="cad-file-name"]')?.textContent).toBe(
      'plan.dwg'
    )
    expect(promptText()).toContain('AutoCAD 2018')
    expect(fake.recents).toContain('home:Drawings/plan.dwg')
    // Opening is not an edit.
    expect(fake.titles.at(-1)).toBe('plan.dwg')
  })

  it('saves a DWG drawing as a .dxf beside it and leaves the .dwg as it was', async () => {
    stubServer(() => ({ binary: gzipSync(SMALL_DXF), code: 1000 }))
    const fake = createFakeSystem({
      files: { 'home:Drawings/plan.dwg': DWG },
      intent: { root: 'home', openPath: 'Drawings/plan.dwg' },
    })
    const view = renderWithSystem(
      <App windowId="window-1" host={fakeHost({ server: SERVER })} />,
      fake.system
    )
    await until(() => promptText().includes('Converted from DWG'))
    typeLine('C')
    typeLine('5,5')
    typeLine('2')
    expect(fake.titles.at(-1)).toBe('plan.dwg •')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    })
    await settle()
    expect(document.body.textContent).toContain('saved as plan.dxf beside it')
    clickButton('Save')
    await settle()
    await settle()
    expect(new TextDecoder().decode(fake.files.get('home:Drawings/plan.dwg'))).toBe(DWG)
    const saved = readDxf(fake.files.get('home:Drawings/plan.dxf')!).doc
    expect(saved.all().some((e) => e.kind === 'circle')).toBe(true)
    // The window now edits the DXF: its name, a clean title, and plain saves.
    expect(view.container.querySelector('[data-testid="cad-file-name"]')?.textContent).toBe(
      'plan.dxf'
    )
    expect(fake.titles.at(-1)).toBe('plan.dxf')
  })

  it('asks before replacing a .dxf already beside the DWG', async () => {
    stubServer(() => ({ binary: gzipSync(SMALL_DXF), code: 1000 }))
    const fake = createFakeSystem({
      files: { 'home:plan.dwg': DWG, 'home:plan.dxf': 'an older export' },
      intent: { root: 'home', openPath: 'plan.dwg' },
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost({ server: SERVER })} />, fake.system)
    await until(() => promptText().includes('Converted from DWG'))
    typeLine('C')
    typeLine('5,5')
    typeLine('2')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    })
    await settle()
    expect(document.body.textContent).toContain('plan.dxf already exists beside it')
    clickButton('Cancel')
    await settle()
    expect(new TextDecoder().decode(fake.files.get('home:plan.dxf'))).toBe('an older export')
    expect(fake.titles.at(-1)).toBe('plan.dwg •')
  })

  it('says so when there is no server, and a DXF still opens', async () => {
    const fake = createFakeSystem({
      files: { 'home:plan.dwg': DWG },
      intent: { root: 'home', openPath: 'plan.dwg' },
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'The Office server is not answering, so plan.dwg could not be converted. DXF drawings still open.'
    )
    expect(fake.notifications.at(-1)?.level).toBe('error')
  })

  it('says so when the server does not answer', async () => {
    stubServer(() => ({ code: 1006 }))
    const fake = createFakeSystem({
      files: { 'home:plan.dwg': DWG },
      intent: { root: 'home', openPath: 'plan.dwg' },
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost({ server: SERVER })} />, fake.system)
    await until(() => !!document.querySelector('[role="alert"]'))
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(
      /^The Office server is not answering/
    )
  })

  it('names the version LibreDWG could not read, and the other failures in a sentence', async () => {
    const cases: [Reply, RegExp][] = [
      [
        { text: '{"error":"unreadable","version":"AC1032"}', code: 1000 },
        /could not read plan\.dwg \(AutoCAD 2018 format\)/,
      ],
      [{ text: '{"error":"timeout","version":"AC1015"}', code: 1000 }, /took longer than 60 s/],
      [{ text: '{"error":"not-dwg"}', code: 1000 }, /plan\.dwg is not a DWG drawing/],
      [{ code: 1009 }, /CAD converts DWG drawings up to 50 MB/],
    ]
    for (const [reply, sentence] of cases) {
      stubServer(() => reply)
      const fake = createFakeSystem({
        files: { 'home:plan.dwg': DWG },
        intent: { root: 'home', openPath: 'plan.dwg' },
      })
      renderWithSystem(<App windowId="window-1" host={fakeHost({ server: SERVER })} />, fake.system)
      await until(() => !!document.querySelector('[role="alert"]'))
      expect(document.querySelector('[role="alert"]')?.textContent).toMatch(sentence)
      cleanupRendered()
    }
  })
})
