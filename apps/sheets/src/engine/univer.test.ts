// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CALCULATION_WAIT_MS, createSheetEngine } from './univer'

/**
 * Univer, at the module boundary: what is under test is how Sheets wires the
 * formula worker into the preset, waits for a calculation before a save and
 * tells edits from recalculation. jsdom has no Worker, so a fake records how it
 * was started.
 */
const u = vi.hoisted(() => ({
  presetConfig: null as null | Record<string, unknown>,
  commandListener: null as null | ((c: { type: number; id: string }) => void),
  waits: [] as (number | undefined)[],
  calculation: Promise.resolve() as Promise<void>,
  saved: 0,
  univerDisposed: false,
  order: [] as string[],
}))

vi.mock('@univerjs/presets', () => ({
  LocaleType: { EN_US: 'enUS' },
  defaultTheme: {},
  merge: (a: object, b: object) => ({ ...a, ...b }),
  createUniver: () => ({
    univer: {
      dispose: () => {
        u.univerDisposed = true
        u.order.push('univer.dispose')
      },
    },
    univerAPI: {
      createWorkbook: () => ({
        dispose: () => {},
        save: () => {
          u.saved++
          u.order.push('save')
          return { id: 'wb', sheetOrder: [] }
        },
      }),
      onCommandExecuted: (cb: (c: { type: number; id: string }) => void) => {
        u.commandListener = cb
        return { dispose: () => {} }
      },
      getFormula: () => ({
        onCalculationResultApplied: (timeout?: number) => {
          u.waits.push(timeout)
          u.order.push('wait')
          return u.calculation
        },
      }),
    },
  }),
}))

vi.mock('@univerjs/preset-sheets-core', () => ({
  UniverSheetsCorePreset: (config: Record<string, unknown>) => {
    u.presetConfig = config
    return { plugins: [] }
  },
}))
vi.mock('@univerjs/preset-sheets-core/locales/en-US', () => ({ default: {} }))

class FakeWorker {
  static started: FakeWorker[] = []
  terminated = false
  readonly url: URL | string
  readonly options?: WorkerOptions
  constructor(url: URL | string, options?: WorkerOptions) {
    this.url = url
    this.options = options
    FakeWorker.started.push(this)
  }
  terminate() {
    this.terminated = true
    u.order.push('worker.terminate')
  }
}

beforeEach(() => {
  FakeWorker.started = []
  vi.stubGlobal('Worker', FakeWorker)
  Object.assign(u, {
    presetConfig: null,
    commandListener: null,
    waits: [],
    calculation: Promise.resolve(),
    saved: 0,
    univerDisposed: false,
    order: [],
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Sheets engine', () => {
  it("starts this window's formula worker as a module file and hands it to the preset", async () => {
    const container = document.createElement('div')
    const engine = await createSheetEngine(container)
    expect(FakeWorker.started).toHaveLength(1)
    const [worker] = FakeWorker.started
    expect(new URL(String(worker.url)).pathname).toMatch(/\/formulaWorker\.ts$/)
    expect(worker.options).toEqual({ type: 'module' })
    // A Worker, not a URL: Univer would start a URL as a classic worker.
    expect(u.presetConfig).toMatchObject({ container, workerURL: worker })
    engine.destroy()
  })

  it('terminates the worker after Univer is disposed: Univer does not own a worker it was handed', async () => {
    const engine = await createSheetEngine(document.createElement('div'))
    engine.destroy()
    expect(FakeWorker.started[0].terminated).toBe(true)
    expect(u.order).toEqual(['univer.dispose', 'worker.terminate'])
  })

  it('waits for the latest calculation before it snapshots the workbook for a save', async () => {
    const engine = await createSheetEngine(document.createElement('div'))
    expect(await engine.snapshot()).toBeNull()
    expect(u.waits).toEqual([])

    engine.loadWorkbook({ id: 'wb' })
    let finish = () => {}
    u.calculation = new Promise<void>((resolve) => {
      finish = resolve
    })
    const pending = engine.snapshot()
    await Promise.resolve()
    expect(u.waits).toEqual([CALCULATION_WAIT_MS])
    expect(u.saved).toBe(0)
    finish()
    expect(await pending).toEqual({ id: 'wb', sheetOrder: [] })
    expect(u.order).toEqual(['wait', 'save'])
  })

  it('fails the snapshot, writing nothing, when formulas are still calculating at the limit', async () => {
    const engine = await createSheetEngine(document.createElement('div'))
    engine.loadWorkbook({ id: 'wb' })
    u.calculation = Promise.reject(new Error('Calculation end timeout'))
    await expect(engine.snapshot()).rejects.toThrow('Calculation end timeout')
    expect(u.saved).toBe(0)
  })

  it('counts commands as edits, and never the mutations recalculation sends back', async () => {
    vi.useFakeTimers()
    try {
      const engine = await createSheetEngine(document.createElement('div'))
      const edits: number[] = []
      engine.onEdit(() => edits.push(engine.editCount()))
      engine.loadWorkbook({ id: 'wb' })
      // Mutations while the workbook loads and after: formula results from the worker.
      u.commandListener!({ type: 2, id: 'sheet.command.set-range-values' })
      vi.runAllTimers()
      u.commandListener!({ type: 2, id: 'sheet.mutation.set-formula-calculation-result' })
      u.commandListener!({ type: 2, id: 'sheet.mutation.set-range-values' })
      expect(edits).toEqual([])
      u.commandListener!({ type: 1, id: 'sheet.command.set-range-values' })
      expect(edits).toEqual([1])
    } finally {
      vi.useRealTimers()
    }
  })
})
