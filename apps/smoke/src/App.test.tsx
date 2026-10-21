// @vitest-environment jsdom
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
import { countLines } from './lines'

/** jsdom has no Worker: run the worker's job on the main thread, after a tick, like a real reply. */
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: number }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  terminated = false
  readonly url: string
  constructor(url: URL | string) {
    this.url = String(url)
    FakeWorker.instances.push(this)
  }
  postMessage(data: ArrayBuffer) {
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: countLines(new Uint8Array(data)) })
    }, 0)
  }
  terminate() {
    this.terminated = true
  }
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  cleanupRendered()
  vi.unstubAllGlobals()
})

const opened = { root: 'home', openPath: 'notes/hello.txt' }

describe('smoke App', () => {
  it('reads the file the window was opened with and shows its size', async () => {
    const fake = createFakeSystem({
      files: { 'home:notes/hello.txt': 'one\ntwo\nthree' },
      intent: opened,
    })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    await settle()

    expect(fake.fsCalls).toEqual(['readWithVersion home:notes/hello.txt'])
    expect(view.container.textContent).toContain('hello.txt')
    expect(view.container.textContent).toContain('13 bytes')
    expect(view.container.textContent).toContain('3 lines (counted in a worker)')
    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0].url).toMatch(/lines\.worker\.ts\b/)
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })

  it('shows the window and app it was rendered for', () => {
    const fake = createFakeSystem()
    const view = renderWithSystem(
      <App windowId="window-7" host={fakeHost({ appId: 'office-smoke' })} />,
      fake.system
    )
    expect(view.container.textContent).toContain('window-7')
    expect(view.container.textContent).toContain('office-smoke')
  })

  it('says so when it was opened without a file, and reads nothing', async () => {
    const fake = createFakeSystem()
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    expect(view.container.textContent).toContain('Open a file with this app from File Manager')
    expect(fake.fsCalls).toEqual([])
  })

  it('shows the kit sentence when the file cannot be read', async () => {
    const fake = createFakeSystem({ intent: opened })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    expect(view.container.textContent).toContain('This file no longer exists.')
  })

  it('reads the new file when an open window is handed another one', async () => {
    const fake = createFakeSystem({
      files: { 'home:notes/hello.txt': 'hi', 'home:notes/other.txt': 'a longer file\n' },
      intent: opened,
    })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settle()
    fake.deliverIntent({ root: 'home', openPath: 'notes/other.txt' })
    await settle()
    await settle()
    expect(view.container.textContent).toContain('other.txt')
    expect(view.container.textContent).toContain('14 bytes')
    expect(view.container.textContent).toContain('1 line (counted in a worker)')
  })

  it('opens the kit ConfirmDialog from the kit Button, and closes it', async () => {
    const fake = createFakeSystem()
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    clickButton('Open a dialog')
    await settle()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Smoke test')
    expect(dialog?.textContent).toContain("the desktop's own ConfirmDialog")

    clickButton('Confirm')
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(view.container.textContent).toContain('Confirmed once.')

    clickButton('Open a dialog')
    await settle()
    clickButton('Cancel')
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(view.container.textContent).toContain('Confirmed once.')
  })

  it('stops its worker when the window closes mid-count', async () => {
    const fake = createFakeSystem({ files: { 'home:notes/hello.txt': 'x' }, intent: opened })
    const view = renderWithSystem(<App windowId="window-1" host={fakeHost()} />, fake.system)
    await settleReadOnly()
    expect(FakeWorker.instances).toHaveLength(1)
    view.unmount()
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })
})

/** Settle the read but not the worker's reply (that waits for a timer). */
async function settleReadOnly() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
