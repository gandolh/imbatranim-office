/**
 * Univer's formula engine, off the main thread.
 *
 * `createSheetEngine` (./univer.ts) starts this file as a module worker and
 * hands it to `UniverSheetsCorePreset({ workerURL })`. That preset then adds
 * Univer's RPC main-thread plugin and tells the sheets and formula plugins not
 * to execute formulas themselves (`notExecuteFormula`). This side boots a
 * second, headless Univer with the preset's worker half: the sheets model
 * (formula-related mutations only), the formula engine and the RPC
 * worker-thread plugin. Edits reach it as mutations over RPC, and the results
 * go back the same way, as `sheet.mutation.*`, which Sheets' dirty tracking
 * never counts as an edit.
 *
 * Univer 0.25.1: `@univerjs/preset-sheets-core/worker` exports
 * `UniverSheetsCoreWorkerPreset` (lib/es/worker.js). Nothing here imports the
 * UI packages, React or the desktop's kit; the OS build refuses a worker that
 * does.
 */
import { createUniver, LocaleType } from '@univerjs/presets'
import { UniverSheetsCoreWorkerPreset } from '@univerjs/preset-sheets-core/worker'

createUniver({
  locale: LocaleType.EN_US,
  presets: [UniverSheetsCoreWorkerPreset()],
})
