import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileWarning, Loader2, Save, Sheet as SheetIcon } from 'lucide-react'
import {
  Button,
  Tooltip,
  fileName,
  reportFileFailure,
  reportFileRefusal,
  saveOverRead,
  useConfirm,
  useFileConflict,
  useFileDialog,
  useOpenIntent,
  useSaveHotkey,
  useSystem,
  useUnsavedGuard,
} from '@imbatranim/ui'
import { createSheetEngine, type SheetEngine } from './engine/univer'
import { retainXlsxWorker, univerToXlsx, xlsxToUniver } from './engine/xlsxBridge'
import { csvToUniver, univerToCsv } from './engine/csv'
import { lossyWarning, type LossyFeature } from './engine/xlsxScan'
import { sniffReason, unsupportedReason } from './engine/formats'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function Sheets({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent()

  // Lets the app open a file on its own instead of dead-ending on
  // "open one from Files". The pick latches into the same store
  // useOpenIntent reads, so the existing load path runs unchanged.
  const { openFile } = useFileDialog()
  const { confirm, confirmDialog } = useConfirm()
  const pickFile = () => void openFile({ extensions: ['xlsx', 'csv'] })
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<SheetEngine | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Kept in view for as long as the file is open, not just as a toast: it is a
  // standing property of this workbook, and the moment it matters is the moment
  // the user reaches for Save — which may be an hour after a toast has gone.
  const [lossy, setLossy] = useState<LossyFeature[]>([])
  // The version of the file this workbook was read from (brief 155): a save
  // sends it, so a file changed on disk since asks instead of being overwritten.
  const diskVersionRef = useRef<string | null>(null)
  // Bumped by "Reload from disk" to run the load again on the same file.
  const [reloadKey, setReloadKey] = useState(0)
  const { ask: askConflict, dialog: conflictDialog } = useFileConflict()

  const name = source ? fileName(source.path, 'workbook.xlsx') : ''
  const isCsv = /\.csv$/i.test(source?.path ?? '')
  const lossyNote = lossyWarning(lossy)

  // Refuse what ExcelJS cannot read before it is asked: by name, before a byte
  // is fetched, and from the first bytes of a workbook that is not a zip. An
  // .xls used to open as an empty grid that a save wrote over (formats.ts).
  const refusal = source ? unsupportedReason(source.path) : null
  const sourceKey = source ? `${source.root}:${source.path}:${reloadKey}` : null
  const [sniffed, setSniffed] = useState<{ key: string; reason: string } | null>(null)
  const refused = refusal ?? (sniffed && sniffed.key === sourceKey ? sniffed.reason : null)

  // Said once, in the notification centre as well as in the window.
  useEffect(() => {
    if (!refusal || !source) return
    reportFileRefusal(system, refusal, { name: fileName(source.path, 'workbook.xlsx') })
  }, [system, refusal, source])

  // Boot Univer, fetch the file, map it through the ExcelJS bridge into the grid.
  useEffect(() => {
    if (!source || refusal) return
    const container = containerRef.current
    if (!container) return
    const releaseWorker = retainXlsxWorker()
    let cancelled = false
    let engine: SheetEngine | null = null
    const csvFile = /\.csv$/i.test(source.path)
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { bytes, version } = await system.fs.readWithVersion(source.root, source.path)
        if (cancelled) return
        const why = csvFile ? null : sniffReason(new Uint8Array(bytes))
        if (why) {
          const docName = fileName(source.path, 'workbook.xlsx')
          setSniffed({ key: `${source.root}:${source.path}:${reloadKey}`, reason: why })
          reportFileRefusal(system, why, { name: docName })
          return
        }
        engine = await createSheetEngine(container)
        if (cancelled) {
          engine.destroy()
          return
        }
        engineRef.current = engine
        engine.onEdit(() => setDirty(true))
        diskVersionRef.current = version

        if (csvFile) {
          engine.loadWorkbook(csvToUniver(decoder.decode(bytes), fileName(source.path, 'Sheet1')))
          setLossy([])
        } else {
          const { workbook, lossy: found } = await xlsxToUniver(bytes)
          if (cancelled) return
          engine.loadWorkbook(workbook)
          setLossy(found)
          // Sticky in the notification centre as well as in the window: a user
          // who opens six workbooks and comes back later still needs to know
          // which one will lose its charts.
          const warning = lossyWarning(found)
          if (warning) {
            system.notify({
              level: 'warning',
              title: 'Some of this workbook cannot be saved',
              body: `${fileName(source.path, 'workbook.xlsx')} — ${warning}`,
            })
          }
        }
        setDirty(false)
      } catch (err) {
        if (!cancelled) {
          setError(
            reportFileFailure(system, 'open', err, {
              noun: 'spreadsheet',
              name: fileName(source.path, 'workbook.xlsx'),
            })
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      engineRef.current = null
      engine?.destroy()
      releaseWorker()
    }
  }, [source, system, reloadKey, refusal])

  const handleSave = useCallback(async () => {
    const engine = engineRef.current
    if (!engine || !source || saving) return
    const snapshot = engine.snapshot()
    if (!snapshot) return

    // CSV holds a single sheet, and `univerToCsv` writes only the first — so a
    // multi-sheet workbook saved to .csv silently drops every other sheet. Say
    // so and get explicit consent before proceeding (the promised warning that
    // was never built): a quiet save that discards sheets is exactly the kind of
    // data loss this app must not do.
    if (isCsv && (snapshot.sheetOrder?.length ?? 0) > 1) {
      const count = snapshot.sheetOrder.length
      const firstId = snapshot.sheetOrder[0]
      const firstName = snapshot.sheets?.[firstId]?.name ?? 'the first sheet'
      const ok = await confirm({
        title: 'CSV saves one sheet only',
        message: `This workbook has ${count} sheets, but a CSV file holds only one. Saving will write "${firstName}" and discard the other ${count - 1}. To keep every sheet, save it as an .xlsx file instead.`,
        confirmLabel: 'Save first sheet only',
        destructive: true,
      })
      // Cancel leaves `dirty` armed and the file untouched — the workbook still
      // differs from disk, so the Save button and close guard stay active.
      if (!ok) return
    }

    // Record the edit counter at snapshot time. If the user edits while the
    // serialize+upload is in flight the counter advances, so we must NOT clear
    // dirty on resolve — those edits aren't in the bytes we uploaded.
    const savedAtEditCount = engine.editCount()
    setSaving(true)
    setError(null)
    try {
      const docName = fileName(source.path, isCsv ? 'data.csv' : 'workbook.xlsx')
      const bytes = isCsv
        ? (encoder.encode(univerToCsv(snapshot)).slice().buffer as ArrayBuffer)
        : await univerToXlsx(snapshot)
      const result = await saveOverRead(
        system.fs,
        { root: source.root, path: source.path, name: docName },
        bytes,
        diskVersionRef.current,
        askConflict
      )
      // Cancel writes nothing and leaves `dirty` armed. Reload discards these
      // edits and reads the disk copy again; Univer can't undo a reload.
      if (result.outcome === 'cancel') return
      if (result.outcome === 'reload') {
        setReloadKey((k) => k + 1)
        return
      }
      diskVersionRef.current = result.version
      // Only on a resolved write, and only if no edit landed mid-flight — the
      // export ran before the upload, so those edits are not in these bytes.
      if (engine.editCount() === savedAtEditCount) setDirty(false)
    } catch (err) {
      // `dirty` is deliberately untouched: the bytes did not land, so the
      // workbook still differs from disk and the close guard stays armed.
      setError(
        reportFileFailure(system, 'save', err, {
          noun: 'spreadsheet',
          name: fileName(source.path, isCsv ? 'data.csv' : 'workbook.xlsx'),
        })
      )
    } finally {
      setSaving(false)
    }
  }, [source, saving, isCsv, confirm, system, askConflict])

  // Ctrl/Cmd+S saves — but only for the top-most window.
  useSaveHotkey(handleSave)

  // Reflect filename + dirty marker in the window title; closing with unsaved
  // changes asks Save / Don't Save / Cancel through the themed dialog.
  const unsavedDialog = useUnsavedGuard(dirty, name, handleSave)

  if (source && refused) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FileWarning size={40} strokeWidth={1} className="text-error" />
        <span className="font-ui text-on-surface text-[12px] font-semibold">{name}</span>
        <span className="font-ui max-w-[340px] text-[12px]">{refused}</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a spreadsheet instead
        </Button>
      </div>
    )
  }

  if (!source) {
    return (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <SheetIcon size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <Button size="sm" variant="primary" onClick={pickFile}>
          Open a spreadsheet
        </Button>
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-1 border-b px-2 py-1">
        <Tooltip content="Save (Ctrl+S)">
          <Button
            variant="default"
            size="sm"
            className="flex items-center gap-1"
            onClick={() => void handleSave()}
            disabled={saving || loading || !dirty}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </Button>
        </Tooltip>

        <div className="flex-1" />

        {error && (
          <span className="text-error font-ui mr-2 max-w-[280px] truncate text-[11px]">
            {error}
          </span>
        )}
        <span className="font-ui text-on-surface-variant max-w-[200px] truncate text-[11px]">
          {name}
          {dirty ? ' •' : ''}
        </span>
      </div>

      {/* A standing note for the length of the session, not a toast: the moment
          it matters is the moment the user reaches for Save, which can be an
          hour after a toast has gone. */}
      {lossyNote && (
        <div className="border-outline-variant bg-surface-container text-on-surface font-ui flex items-start gap-2 border-b px-2 py-1.5 text-[11px]">
          <AlertTriangle size={13} className="text-error mt-[1px] shrink-0" />
          <span className="min-w-0 flex-1">{lossyNote}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-on-surface-variant hover:text-on-surface shrink-0"
            onClick={() => setLossy([])}
          >
            ×
          </button>
        </div>
      )}

      {/* Grid surface — Univer mounts its canvas here. */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && (
          <div className="bg-surface-container-lowest text-on-surface-variant font-ui absolute inset-0 flex items-center justify-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            Loading spreadsheet…
          </div>
        )}
      </div>
      {confirmDialog}
      {unsavedDialog}
      {conflictDialog}
    </div>
  )
}
