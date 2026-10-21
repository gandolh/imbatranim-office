/**
 * CAD's file spine, the way the OS's built-in editors do it, in one place so
 * it can be shared with the other office apps later:
 *
 * - the window's file comes from `useOpenIntent` (File Manager, recents, Open)
 * - it is read with `readWithVersion`; the version goes back with a save
 *   (`saveOverRead`), so a file changed on disk since asks first
 *   (`useFileConflict`: Overwrite, Reload from disk, Cancel)
 * - Save as goes through the OS's save dialog, and the window then edits the
 *   new file
 * - Ctrl+S saves the top window (`useSaveHotkey`); the title carries the
 *   dirty mark and closing asks Save / Don't Save / Cancel (`useUnsavedGuard`)
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
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
import { readDxf, type ReadReport } from '../engine/dxf/read'
import { refuseReason } from '../engine/dxf/tags'
import { writeDxfBytes, type WriteReport } from '../engine/dxf/write'
import { Editor } from '../engine/editor'
import { exportInWorker, exportRequest, type ExportKind } from '../engine/export/job'

export type FileTarget = { root: string; path: string }

export type CadFile = {
  editor: Editor
  /** The file name shown in the title ("Drawing1.dxf" before a first save). */
  name: string
  target: FileTarget | null
  loading: boolean
  /** Why the file could not be opened (shown in the window), or null. */
  error: string | null
  dirty: boolean
  saving: boolean
  exporting: ExportKind | null
  save(): Promise<void>
  saveAs(): Promise<void>
  open(): Promise<void>
  newDrawing(): Promise<void>
  exportAs(kind: ExportKind): Promise<void>
  /** Render once, anywhere: the unsaved-changes, conflict and confirm dialogs. */
  dialogs: ReactNode
}

const UNTITLED = 'Drawing1.dxf'

const KIND_WORDS: Record<string, [string, string]> = {
  DIMENSION: ['dimension', 'dimensions'],
  HATCH: ['hatch', 'hatches'],
  LEADER: ['leader', 'leaders'],
  SPLINE: ['spline', 'splines'],
  ACAD_TABLE: ['table', 'tables'],
  SOLID: ['solid', 'solids'],
  MULTILEADER: ['multileader', 'multileaders'],
}

/** "7 dimensions, 5 hatches and 1 leader". */
export function describeKinds(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([type, n]) => {
    const words = KIND_WORDS[type] ?? [type, type]
    return `${n} ${n === 1 ? words[0] : words[1]}`
  })
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function readNote(report: ReadReport): string | null {
  if (Object.keys(report.foreign).length === 0) return null
  return `Shown as drawn, not editable here yet: ${describeKinds(report.foreign)}. They are saved back unchanged.`
}

function writeNote(report: WriteReport): string | null {
  const notes: string[] = []
  if (report.converted.ACAD_TABLE)
    notes.push(
      `${describeKinds({ ACAD_TABLE: report.converted.ACAD_TABLE })} saved as a block reference`
    )
  if (Object.keys(report.dropped).length > 0)
    notes.push(`${describeKinds(report.dropped)} could not be written`)
  return notes.length ? `${notes.join('; ')}.` : null
}

const withDxf = (path: string) => (/\.dxf$/i.test(path) ? path : `${path}.dxf`)
const stem = (name: string) => name.replace(/\.[^.]+$/, '')

export function useCadFile(): CadFile {
  const system = useSystem()
  const launched = useOpenIntent()
  const { openFile, saveFile } = useFileDialog()
  const { ask: askConflict, dialog: conflictDialog } = useFileConflict()
  const { confirm, confirmDialog } = useConfirm()
  const [editor, setEditor] = useState(() => new Editor())
  const [target, setTarget] = useState<FileTarget | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** The document version on disk; dirty while the open document differs. */
  const [savedVersion, setSavedVersion] = useState(0)
  const [docVersion, setDocVersion] = useState(0)
  const diskVersionRef = useRef<string | null>(null)
  /** "Reload from disk" reads the file the window edits now, which Save as may have changed. */
  const reloadFromRef = useRef<FileTarget | null>(null)

  useEffect(
    () =>
      editor.subscribe((c) => {
        if (c === 'state') setDocVersion(editor.doc.version)
      }),
    [editor]
  )

  const name = target ? fileName(target.path, UNTITLED) : UNTITLED
  const dirty = docVersion !== savedVersion

  // The window's file: load it whenever File Manager hands over another one.
  useEffect(() => {
    const from = reloadFromRef.current
    reloadFromRef.current = null
    const source = from ? { root: from.root, path: from.path } : launched
    if (!source) return
    const refusal = /\.dxf$/i.test(source.path)
      ? null
      : /\.dwg$/i.test(source.path)
        ? 'CAD opens DXF drawings; DWG is not supported. Save it as DXF first.'
        : 'CAD opens .dxf drawings.'
    if (refusal) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setError(reportFileRefusal(system, refusal, { name: fileName(source.path) }))
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    system.fs.readWithVersion(source.root, source.path).then(
      ({ bytes, version }) => {
        if (cancelled) return
        const data = new Uint8Array(bytes)
        const why = refuseReason(data)
        if (why) {
          setError(reportFileRefusal(system, why, { name: fileName(source.path) }))
          setLoading(false)
          return
        }
        try {
          const { doc, report } = readDxf(data)
          const next = new Editor(doc)
          const note = readNote(report)
          if (note) next.message(note)
          diskVersionRef.current = version
          setEditor(next)
          setTarget({ root: source.root, path: source.path })
          setSavedVersion(doc.version)
          setDocVersion(doc.version)
          system.fs.recordRecent(source.root, source.path)
        } catch (err) {
          setError(
            reportFileFailure(system, 'open', err, { noun: 'drawing', name: fileName(source.path) })
          )
        }
        setLoading(false)
      },
      (err: unknown) => {
        if (cancelled) return
        setError(
          reportFileFailure(system, 'open', err, { noun: 'drawing', name: fileName(source.path) })
        )
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [system, launched, reloadKey])

  const writeTo = useCallback(
    async (to: FileTarget, expected: string | null | undefined): Promise<boolean> => {
      const versionAtSave = editor.doc.version
      const { bytes, report } = writeDxfBytes(editor.doc)
      const label = fileName(to.path)
      const result = await saveOverRead(
        system.fs,
        { ...to, name: label },
        bytes,
        expected,
        askConflict
      )
      if (result.outcome === 'cancel') return false
      if (result.outcome === 'reload') {
        reloadFromRef.current = to
        setReloadKey((k) => k + 1)
        return false
      }
      diskVersionRef.current = result.version
      setSavedVersion(versionAtSave)
      const note = writeNote(report)
      if (note)
        system.notify({ level: 'warning', title: 'Saved with changes', body: `${label}: ${note}` })
      return true
    },
    [system, editor, askConflict]
  )

  const saveAs = useCallback(async () => {
    const choice = await saveFile({
      title: 'Save drawing as',
      extensions: ['dxf'],
      suggestedName: name,
    })
    if (!choice) return
    const to = { root: choice.root, path: withDxf(choice.path) }
    setSaving(true)
    try {
      // A new file: nothing to compare against.
      if (await writeTo(to, undefined)) setTarget(to)
    } catch (err) {
      setError(reportFileFailure(system, 'save', err, { noun: 'drawing', name: fileName(to.path) }))
    } finally {
      setSaving(false)
    }
  }, [saveFile, name, writeTo, system])

  const save = useCallback(async () => {
    if (saving) return
    if (!target) return saveAs()
    setSaving(true)
    try {
      await writeTo(target, diskVersionRef.current)
    } catch (err) {
      // Dirty stays: the bytes did not land, so the close guard keeps the work.
      setError(reportFileFailure(system, 'save', err, { noun: 'drawing', name }))
    } finally {
      setSaving(false)
    }
  }, [saving, target, saveAs, writeTo, system, name])

  const discardOk = useCallback(async () => {
    if (!dirty) return true
    return confirm({
      title: 'Discard changes?',
      message: `${name} has unsaved changes. They will be lost.`,
      confirmLabel: 'Discard',
      destructive: true,
    })
  }, [dirty, confirm, name])

  const open = useCallback(async () => {
    if (!(await discardOk())) return
    await openFile({ title: 'Open drawing', extensions: ['dxf'] })
  }, [discardOk, openFile])

  const newDrawing = useCallback(async () => {
    if (!(await discardOk())) return
    const next = new Editor()
    setEditor(next)
    setTarget(null)
    setError(null)
    diskVersionRef.current = null
    setSavedVersion(next.doc.version)
    setDocVersion(next.doc.version)
  }, [discardOk])

  const exportAs = useCallback(
    async (kind: ExportKind) => {
      const choice = await saveFile({
        title: kind === 'svg' ? 'Export as SVG' : 'Export as PDF',
        extensions: [kind],
        suggestedName: `${stem(name)}.${kind}`,
      })
      if (!choice) return
      const path = new RegExp(`\\.${kind}$`, 'i').test(choice.path)
        ? choice.path
        : `${choice.path}.${kind}`
      setExporting(kind)
      try {
        const bytes = await exportInWorker(exportRequest(editor.doc, kind, stem(name)))
        await system.fs.upload(choice.root, path, bytes, fileName(path))
        system.notify({ level: 'success', title: 'Exported', body: fileName(path) })
      } catch (err) {
        reportFileFailure(system, 'save', err, {
          noun: kind === 'svg' ? 'SVG' : 'PDF',
          name: fileName(path),
        })
      } finally {
        setExporting(null)
      }
    },
    [saveFile, name, editor, system]
  )

  useSaveHotkey(save)
  const unsavedDialog = useUnsavedGuard(dirty, name, save)

  return {
    editor,
    name,
    target,
    loading,
    error,
    dirty,
    saving,
    exporting,
    save,
    saveAs,
    open,
    newDrawing,
    exportAs,
    dialogs: (
      <>
        {unsavedDialog}
        {conflictDialog}
        {confirmDialog}
      </>
    ),
  }
}
