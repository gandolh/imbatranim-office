/**
 * Lazy bridge to Univer (the spreadsheet grid). The Univer presets + render
 * engine are the heaviest dependency in the repo, so everything here is behind a
 * dynamic import — the whole engine (and its CSS) becomes its own build chunk
 * and never touches the desktop boot bundle. Only `import type` lives at module
 * top level, and those are erased at build time.
 */
import type { IWorkbookData } from '@univerjs/presets'

// Minimal shape of the Univer facade surface we actually call. Univer's full
// FUniver/FWorkbook types come from several packages (core augmented by the
// sheets facade); pinning to just what we use keeps this bridge decoupled from
// that augmentation graph.
type UniverWorkbook = { dispose: () => void; save: () => IWorkbookData }
type UniverCommand = { type: number; id: string }
type UniverApi = {
  createWorkbook: (data: Partial<IWorkbookData>) => UniverWorkbook
  onCommandExecuted: (cb: (command: UniverCommand) => void) => { dispose: () => void }
  getFormula: () => { onCalculationResultApplied: (timeout?: number) => Promise<void> }
}
type UniverInstance = { dispose: () => void }

/**
 * How long a save waits for formulas to finish calculating. Generous: a large
 * workbook's first calculation takes seconds, and the engine runs in a worker,
 * so the window stays usable while it waits.
 */
export const CALCULATION_WAIT_MS = 120_000

export type SheetEngine = {
  /** Load a workbook snapshot into the mounted grid. */
  loadWorkbook: (data: Partial<IWorkbookData>) => void
  /**
   * The workbook as a snapshot, for serialization on save, once the formula
   * engine has applied its latest results: a save never writes a value a
   * pending recalculation is about to change. Rejects when formulas are still
   * calculating after {@link CALCULATION_WAIT_MS}.
   */
  snapshot: () => Promise<IWorkbookData | null>
  /** Fire `cb` every time the user mutates the sheet (for dirty tracking). */
  onEdit: (cb: () => void) => void
  /**
   * Monotonic count of every user edit since the current workbook was loaded.
   * Save records this at snapshot time and only clears dirty if it is unchanged
   * once the upload resolves — so edits made mid-save aren't silently clobbered.
   */
  editCount: () => number
  /** Tear down Univer and release its render resources. */
  destroy: () => void
}

/**
 * Boot a Univer instance mounted into `container`. The presets bundle the sheet
 * UI (toolbar, formula bar, grid) so users get a real editor, not a viewer.
 *
 * Formulas calculate in a worker of this window's own (./formulaWorker.ts):
 * a workbook with 220,000 formulas blocked the main thread for 5.6 s when the
 * engine ran here (brief 08). The worker is a file of the app, started as a
 * module, because the desktop's CSP refuses `blob:` workers, and Univer's RPC
 * plugin would start a URL as a classic worker; it takes a `Worker` instead
 * and then leaves its lifetime to us.
 */
export async function createSheetEngine(container: HTMLElement): Promise<SheetEngine> {
  const [{ createUniver, defaultTheme, LocaleType, merge }, sheetsCore, enUS] = await Promise.all([
    import('@univerjs/presets'),
    import('@univerjs/preset-sheets-core'),
    import('@univerjs/preset-sheets-core/locales/en-US'),
  ])

  const formulaWorker = new Worker(new URL('./formulaWorker.ts', import.meta.url), {
    type: 'module',
  })
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: merge({}, enUS.default),
    },
    theme: defaultTheme,
    presets: [
      sheetsCore.UniverSheetsCorePreset({
        container,
        workerURL: formulaWorker,
      }),
    ],
  }) as unknown as { univer: UniverInstance; univerAPI: UniverApi }

  let workbook: UniverWorkbook | null = null
  let editListeners: Array<() => void> = []
  // Counts EVERY user edit since the last load, so a save can tell whether
  // edits landed while it was in flight.
  let editCount = 0
  // Suppress edit notifications while a workbook is being loaded — building the
  // model can emit mutations that would otherwise register as a user edit.
  let suppressEdits = true

  // Univer namespaces every change: `sheet.command.*` are user-initiated edits,
  // `sheet.mutation.*` are low-level model writes (incl. formula recalculation
  // fired on load), and `sheet.operation.*` are selection/scroll. We latch dirty
  // only on user COMMANDs so opening a workbook (which recalculates formulas via
  // mutations) never registers as an edit. Every edit notifies, not just the
  // first: a save clears dirty, and the next edit must set it again.
  const commandSub = univerAPI.onCommandExecuted((command) => {
    if (
      typeof command.id === 'string' &&
      command.id.startsWith('sheet.command.') &&
      !suppressEdits
    ) {
      editCount++
      editListeners.forEach((cb) => cb())
    }
  })

  return {
    loadWorkbook: (data) => {
      workbook?.dispose()
      editCount = 0
      suppressEdits = true
      workbook = univerAPI.createWorkbook(data)
      // Release suppression once the load's synchronous + immediate-async
      // mutations have flushed; genuine user edits arrive after this.
      setTimeout(() => {
        suppressEdits = false
      }, 0)
    },
    snapshot: async () => {
      if (!workbook) return null
      // Resolves once the latest calculation's results are in the model, or
      // after Univer's start window (500 ms) when none is running or starting.
      await univerAPI.getFormula().onCalculationResultApplied(CALCULATION_WAIT_MS)
      return workbook?.save() ?? null
    },
    onEdit: (cb) => {
      editListeners.push(cb)
    },
    editCount: () => editCount,
    destroy: () => {
      editListeners = []
      commandSub.dispose()
      workbook?.dispose()
      univer.dispose()
      formulaWorker.terminate()
    },
  }
}
