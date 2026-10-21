/**
 * The file side of a Slides window, in one place: what it opened, reading it
 * (with its version token), refusing what it cannot read, saving over it
 * (asking when it changed on disk), Save as, a new blank presentation, the
 * dirty mark in the title, the close guard, Ctrl+S and Download original.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
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
  type FileChoice,
} from '@imbatranim/ui'
import { NotAPresentationError } from '../engine/deck'
import { sniffReason, unsupportedReason } from '../engine/formats'
import { NotAZipError, PackageTooLargeError } from '../engine/zip'
import { DeckStore } from '../editor/store'

export type DeckFileState =
  | { kind: 'empty' }
  | { kind: 'refused'; name: string; message: string }
  | { kind: 'loading'; name: string }
  | { kind: 'failed'; name: string; message: string }
  | { kind: 'open'; store: DeckStore }

export type DeckFile = {
  state: DeckFileState
  /** The open file's name (`Untitled.pptx` for a new presentation). */
  name: string
  saving: boolean
  save: () => Promise<void>
  saveAs: () => Promise<void>
  /** Pick a presentation; it opens here, or in a new window when this one has unsaved work. */
  open: () => Promise<void>
  newDeck: () => Promise<void>
  /** Download the file as it is on disk; null for one never saved. */
  download: (() => void) | null
  /**
   * Run before every save (Ctrl+S, the toolbar, the close dialog): the editor
   * hands over text still being typed. Pass null to clear.
   */
  setBeforeSave: (fn: (() => void) | null) => void
  /** Dialogs to render: the close guard, the save conflict, the discard confirm. */
  dialogs: ReactNode
}

const EXTENSIONS = ['pptx']
const UNTITLED = 'Untitled.pptx'
const NOUN = 'presentation'

type Loaded = { store: DeckStore; key: string }

/** Ends with .pptx (or another extension Slides saves); else gets one. */
function withExtension(path: string): string {
  return unsupportedReason(path) === null ? path : `${path}.pptx`
}

export function useDeckFile(): DeckFile {
  const system = useSystem()
  const source = useOpenIntent()
  const { openFile, saveFile } = useFileDialog()
  const { ask: askConflict, dialog: conflictDialog } = useFileConflict()
  const { confirm, confirmDialog } = useConfirm()

  const sourceKey = source ? `${source.root}:${source.path}` : null
  /** Where the document lives now: the opened file, or where Save as put it. */
  const [target, setTarget] = useState<{ forKey: string | null; file: FileChoice | null } | null>(
    null
  )
  const file: FileChoice | null = useMemo(
    () =>
      target && target.forKey === sourceKey
        ? target.file
        : source
          ? { root: source.root, path: source.path }
          : null,
    [target, sourceKey, source]
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [blank, setBlank] = useState<{ forKey: string | null; store: DeckStore } | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    kind: 'refused' | 'failed'
    message: string
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const versionRef = useRef<string | null>(null)
  const beforeSave = useRef<(() => void) | null>(null)
  const setBeforeSave = useCallback((fn: (() => void) | null) => {
    beforeSave.current = fn
  }, [])

  const name = file ? fileName(file.path, 'presentation.pptx') : UNTITLED
  const refusal = source ? unsupportedReason(source.path) : null

  useEffect(() => {
    if (!source || !refusal) return
    reportFileRefusal(system, refusal, { name: fileName(source.path) })
  }, [system, source, refusal])

  // Read the file this window was opened with (again on "Reload from disk").
  useEffect(() => {
    if (!source || refusal) return
    const key = `${source.root}:${source.path}#${reloadKey}`
    let cancelled = false
    const docName = fileName(source.path, 'presentation.pptx')
    system.fs.readWithVersion(source.root, source.path).then(
      ({ bytes, version }) => {
        if (cancelled) return
        const data = new Uint8Array(bytes)
        const sniffed = sniffReason(data)
        if (sniffed) {
          setFailure({
            key,
            kind: 'refused',
            message: reportFileRefusal(system, sniffed, { name: docName }),
          })
          return
        }
        try {
          const store = DeckStore.open(data)
          versionRef.current = version
          setLoaded({ store, key })
          setFailure(null)
        } catch (err) {
          const known =
            err instanceof NotAZipError ||
            err instanceof NotAPresentationError ||
            err instanceof PackageTooLargeError
          setFailure({
            key,
            kind: known ? 'refused' : 'failed',
            message: known
              ? reportFileRefusal(system, (err as Error).message, { name: docName })
              : reportFileFailure(system, 'open', err, { noun: NOUN, name: docName }),
          })
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setFailure({
            key,
            kind: 'failed',
            message: reportFileFailure(system, 'open', err, { noun: NOUN, name: docName }),
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [system, source, refusal, reloadKey])

  const currentKey = source ? `${source.root}:${source.path}#${reloadKey}` : null
  const store: DeckStore | null =
    blank && blank.forKey === sourceKey
      ? blank.store
      : loaded && loaded.key === currentKey
        ? loaded.store
        : null

  // Re-render on every edit: the dirty mark and the guard read the store.
  useSyncExternalStore(
    useCallback((l: () => void) => (store ? store.subscribe(l) : () => undefined), [store]),
    () => (store ? store.getVersion() : -1)
  )
  const dirty = store?.dirty ?? false

  const state: DeckFileState = useMemo(() => {
    if (store) return { kind: 'open', store }
    if (source && refusal) return { kind: 'refused', name, message: refusal }
    if (failure && failure.key === currentKey)
      return { kind: failure.kind, name, message: failure.message }
    if (source) return { kind: 'loading', name }
    return { kind: 'empty' }
  }, [store, source, refusal, failure, currentKey, name])

  const saveAs = useCallback(async () => {
    if (!store || saving) return
    beforeSave.current?.()
    const choice = await saveFile({
      title: 'Save presentation as',
      suggestedName: name,
      extensions: EXTENSIONS,
    })
    if (!choice) return
    const path = withExtension(choice.path)
    const chosen = { root: choice.root, path }
    setSaving(true)
    try {
      const { bytes, token } = store.snapshot()
      const written = await system.fs.upload(chosen.root, chosen.path, bytes, fileName(path))
      versionRef.current = written.version
      store.markSaved(token)
      setTarget({ forKey: sourceKey, file: chosen })
      if (path !== choice.path) system.fs.recordRecent(chosen.root, chosen.path)
    } catch (err) {
      reportFileFailure(system, 'save', err, { noun: NOUN, name: fileName(path) })
    } finally {
      setSaving(false)
    }
  }, [store, saving, saveFile, name, system, sourceKey])

  const save = useCallback(async () => {
    if (!store || saving) return
    beforeSave.current?.()
    if (!file) return saveAs()
    setSaving(true)
    try {
      const { bytes, token } = store.snapshot()
      const result = await saveOverRead(
        system.fs,
        { root: file.root, path: file.path, name },
        bytes,
        versionRef.current,
        askConflict
      )
      if (result.outcome === 'cancel') return
      if (result.outcome === 'reload') {
        // Edits are dropped for the copy on disk.
        setTarget(null)
        setBlank(null)
        setReloadKey((k) => k + 1)
        return
      }
      versionRef.current = result.version
      store.markSaved(token)
    } catch (err) {
      // The bytes did not land: the document stays dirty and the guard armed.
      reportFileFailure(system, 'save', err, { noun: NOUN, name })
    } finally {
      setSaving(false)
    }
  }, [store, saving, file, saveAs, system, name, askConflict])

  useSaveHotkey(save)
  const unsavedDialog = useUnsavedGuard(dirty, state.kind === 'empty' ? '' : name, save)

  const open = useCallback(async () => {
    if (dirty) {
      // Unsaved work stays where it is: the other file gets a window of its own.
      const choice = await system.fs.pickOpen({
        title: 'Open presentation',
        extensions: EXTENSIONS,
      })
      if (choice) {
        system.fs.recordRecent(choice.root, choice.path)
        system.intents.openApp(system.appId, { root: choice.root, openPath: choice.path })
      }
      return
    }
    const choice = await openFile({ title: 'Open presentation', extensions: EXTENSIONS })
    if (choice) {
      setBlank(null)
      setTarget(null)
    }
  }, [dirty, openFile, system])

  const newDeck = useCallback(async () => {
    if (dirty) {
      const discard = await confirm({
        title: 'New presentation',
        message: `Discard the unsaved changes to ${name} and start a new presentation?`,
        confirmLabel: 'Discard',
        destructive: true,
      })
      if (!discard) return
    }
    setBlank({ forKey: sourceKey, store: DeckStore.blank() })
    setTarget({ forKey: sourceKey, file: null })
  }, [dirty, confirm, name, sourceKey])

  const download = useMemo(() => {
    if (!file || (blank && blank.forKey === sourceKey && !target?.file)) return null
    return () => {
      const a = document.createElement('a')
      a.href = system.fs.downloadUrl(file.root, file.path)
      a.download = fileName(file.path, 'presentation.pptx')
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  }, [file, blank, sourceKey, target, system])

  return {
    state,
    name,
    saving,
    save,
    saveAs,
    open,
    newDeck,
    download,
    setBeforeSave,
    dialogs: (
      <>
        {unsavedDialog}
        {conflictDialog}
        {confirmDialog}
      </>
    ),
  }
}
