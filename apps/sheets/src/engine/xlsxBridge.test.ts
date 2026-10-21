import type { IWorkbookData } from '@univerjs/presets'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerReply, WorkerRequest } from './xlsxWorker'

/**
 * The bridge's worker lifetime, with a stand-in Worker: windows share the one
 * worker, so it lives while any window holds it or any request waits on it.
 */
class FakeWorker {
  static created: FakeWorker[] = []
  onmessage: ((ev: { data: WorkerReply }) => void) | null = null
  onerror: ((ev: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: WorkerRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.created.push(this)
  }
  postMessage(message: WorkerRequest) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
  }
  /** Answer the oldest request still waiting. */
  answer(result: unknown) {
    const request = this.posted.shift()
    if (!request) throw new Error('nothing to answer')
    this.onmessage?.({ data: { id: request.id, result } as WorkerReply })
  }
}

let bridge: typeof import('./xlsxBridge')

beforeEach(async () => {
  FakeWorker.created = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.resetModules() // the worker and the count are module state
  bridge = await import('./xlsxBridge')
})

afterEach(() => vi.unstubAllGlobals())

const parsed = { workbook: {}, lossy: [] }
const snapshot = {} as IWorkbookData

describe('the shared xlsx worker', () => {
  it('stays while any window holds it and goes with the last one', async () => {
    const closeA = bridge.retainXlsxWorker()
    const closeB = bridge.retainXlsxWorker()
    const open = bridge.xlsxToUniver(new ArrayBuffer(1))
    const [worker] = FakeWorker.created
    worker.answer(parsed)
    await expect(open).resolves.toEqual(parsed)

    closeA()
    expect(worker.terminated).toBe(false)
    closeB()
    expect(worker.terminated).toBe(true)
    closeB() // a second call is a no-op, not another window's release

    // The next window starts a fresh worker.
    const closeC = bridge.retainXlsxWorker()
    const again = bridge.xlsxToUniver(new ArrayBuffer(1))
    expect(FakeWorker.created).toHaveLength(2)
    FakeWorker.created[1].answer(parsed)
    await again
    closeC()
    expect(FakeWorker.created[1].terminated).toBe(true)
  })

  it('finishes a save that is in flight when the last window closes, then terminates', async () => {
    const close = bridge.retainXlsxWorker()
    const save = bridge.univerToXlsx(snapshot)
    close()
    const [worker] = FakeWorker.created
    expect(worker.terminated).toBe(false)

    const bytes = new ArrayBuffer(3)
    worker.answer(bytes)
    await expect(save).resolves.toBe(bytes)
    expect(worker.terminated).toBe(true)
  })

  it('keeps the worker for a window that opens before the last request drains', async () => {
    const closeA = bridge.retainXlsxWorker()
    const save = bridge.univerToXlsx(snapshot)
    closeA()
    const closeB = bridge.retainXlsxWorker()
    const [worker] = FakeWorker.created
    worker.answer(new ArrayBuffer(0))
    await save
    expect(worker.terminated).toBe(false)

    const open = bridge.xlsxToUniver(new ArrayBuffer(1))
    expect(FakeWorker.created).toHaveLength(1)
    worker.answer(parsed)
    await open
    closeB()
    expect(worker.terminated).toBe(true)
  })

  it("survives StrictMode's mount, unmount, mount", async () => {
    // React runs the effect, its cleanup and the effect again before any await.
    bridge.retainXlsxWorker()()
    const close = bridge.retainXlsxWorker()
    const open = bridge.xlsxToUniver(new ArrayBuffer(1))
    expect(FakeWorker.created).toHaveLength(1)
    const [worker] = FakeWorker.created
    worker.answer(parsed)
    await expect(open).resolves.toEqual(parsed)
    expect(worker.terminated).toBe(false)
    close()
    expect(worker.terminated).toBe(true)
  })
})
