// @vitest-environment jsdom
import { act } from 'react'
import type { SystemHandle } from '@imbatranim/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupRendered,
  createFakeSystem,
  fakeHost,
  renderWithSystem,
  settle,
} from '@imbatranim-office/shared/testing'
import { App } from './App'

/**
 * Univer and the xlsx worker, at the module boundary: jsdom has no canvas and
 * no Worker, and what is under test is Sheets around them, the way the desktop
 * renders it. The fake engine records what it was given.
 */
const engine = vi.hoisted(() => ({
  created: [] as {
    container: HTMLElement
    loaded: unknown[]
    destroyed: boolean
    edit: () => void
  }[],
  lossy: [] as string[],
  retained: 0,
  released: 0,
}))

vi.mock('./engine/univer', () => ({
  createSheetEngine: (container: HTMLElement) => {
    const instance = {
      container,
      loaded: [] as unknown[],
      destroyed: false,
      edit: () => {},
    }
    engine.created.push(instance)
    return Promise.resolve({
      loadWorkbook: (data: unknown) => instance.loaded.push(data),
      snapshot: () => null,
      onEdit: (cb: () => void) => {
        instance.edit = cb
      },
      editCount: () => 0,
      destroy: () => {
        instance.destroyed = true
      },
    })
  },
}))

vi.mock('./engine/xlsxBridge', () => ({
  retainXlsxWorker: () => {
    engine.retained++
    return () => {
      engine.released++
    }
  },
  xlsxToUniver: () =>
    Promise.resolve({ workbook: { id: 'wb', name: 'book' }, lossy: engine.lossy }),
  univerToXlsx: () => Promise.resolve(new ArrayBuffer(0)),
}))

beforeEach(() => {
  engine.created = []
  engine.lossy = []
  engine.retained = 0
  engine.released = 0
})

afterEach(() => {
  cleanupRendered()
  vi.restoreAllMocks()
})

async function openSheet() {
  for (let i = 0; i < 4; i++) await settle()
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

describe('Sheets, as a kit app', () => {
  it('opens the .xlsx the window was opened with, in a grid mounted inside the window', async () => {
    const fake = createFakeSystem({
      appId: 'office-sheets',
      files: { 'home:Documents/book.xlsx': 'PK fake' },
      intent: { root: 'home', openPath: 'Documents/book.xlsx' },
    })
    const view = renderWithSystem(
      <App windowId="window-1" host={fakeHost({ appId: 'office-sheets' })} />,
      fake.system
    )
    await openSheet()

    expect(fake.fsCalls).toEqual(['readWithVersion home:Documents/book.xlsx'])
    expect(engine.created).toHaveLength(1)
    expect(view.container.contains(engine.created[0].container)).toBe(true)
    expect(engine.created[0].loaded).toEqual([{ id: 'wb', name: 'book' }])
    expect(engine.retained).toBe(1)
    expect(fake.notifications).toEqual([])
  })

  it('opens a .csv through the CSV parser, not the worker', async () => {
    const fake = createFakeSystem({
      files: { 'home:Documents/data.csv': 'a,b\r\n007,"x,y"\r\n' },
      intent: { root: 'home', openPath: 'Documents/data.csv' },
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openSheet()

    const [loaded] = engine.created[0].loaded as { sheets: Record<string, { cellData: object }> }[]
    expect(JSON.stringify(loaded)).toContain('007')
    expect(JSON.stringify(loaded)).toContain('x,y')
  })

  it('warns, in the window and the notification centre, when a save would lose something', async () => {
    engine.lossy = ['charts']
    const fake = createFakeSystem({
      files: { 'home:Documents/book.xlsx': 'PK fake' },
      intent: { root: 'home', openPath: 'Documents/book.xlsx' },
    })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openSheet()

    expect(fake.notifications).toHaveLength(1)
    expect(fake.notifications[0]).toMatchObject({
      level: 'warning',
      title: 'Some of this workbook cannot be saved',
    })
    expect(view.container.textContent).toContain('chart')
  })

  it('marks an edit dirty', async () => {
    const fake = createFakeSystem({
      files: { 'home:Documents/book.xlsx': 'PK fake' },
      intent: { root: 'home', openPath: 'Documents/book.xlsx' },
    })
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openSheet()
    act(() => engine.created[0].edit())
    expect(fake.titles.at(-1)).toBe('book.xlsx •')
  })

  it('offers its own Open button when the window was opened without a file', async () => {
    const fake = createFakeSystem()
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    expect(view.container.textContent).toContain('Nothing open')
    expect(engine.created).toHaveLength(0)
  })

  it('tears the grid down and releases the worker when the window closes', async () => {
    const fake = createFakeSystem({
      files: { 'home:Documents/book.xlsx': 'PK fake' },
      intent: { root: 'home', openPath: 'Documents/book.xlsx' },
    })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await openSheet()
    expect(engine.released).toBe(0)
    view.unmount()
    expect(engine.created[0].destroyed).toBe(true)
    expect(engine.released).toBe(1)
  })

  it('uses only the capabilities its descriptor entry asks for', async () => {
    engine.lossy = ['charts']
    const fake = createFakeSystem({
      files: { 'home:Documents/book.xlsx': 'PK fake' },
      intent: { root: 'home', openPath: 'Documents/book.xlsx' },
    })
    const recorded = recordingHandle(fake.system)
    renderWithSystem(<App windowId="window-1" host={fakeHost()} />, recorded.system)
    await openSheet()
    act(() => engine.created[0].edit())
    await settle()

    const always = ['protocolVersion', 'appId', 'windowId', 'window', 'appearance', 'on']
    const capabilities = [...recorded.used].filter((p) => !always.includes(p)).sort()
    expect(capabilities).toEqual(['fs', 'intents', 'notify'])
  })
})
