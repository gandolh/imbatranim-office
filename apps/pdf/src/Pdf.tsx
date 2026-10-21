/**
 * PDF — the merged reader and editor (brief 06: the OS's PDF Viewer and norPDF
 * as one app). Top-level composition of the shell: owns the shared
 * {@link ReaderController} (via context) and lays out the console, side panel
 * and main area. File I/O (OS open-intent + the OS picker + drag-drop) lives
 * here.
 *
 * The first page comes first. Everything this module imports statically is on
 * the way to it: the shell, the reader and the controller, which reaches pdf.js
 * with a dynamic import. The rail's panels, the annotate toolbar and overlay,
 * the forms panel, the organise view, the signature pad and the engine itself
 * are separate chunks (lazy.ts, app/engine.ts) that load once a page is on
 * screen, or when first opened. eslint.config.js keeps it that way.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART B MOUNT POINTS
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. Annotate toolbar  → `<TopBar toolbarSlot={…} />` (a second console row,
 *                         `data-slot="annotate-toolbar"`).
 *  2. Forms panel       → a tab via `<SidePanel extraTabs={[…]} />`.
 *  3. Organize view     → the `mode === 'organize'` branch of the main area.
 *  4. Sign / dialogs    → mounted alongside the shell, driving `doc.sign` then
 *                         a raster sync.
 *  5. Per-page overlay  → PageView mounts the annotation overlay keyed to the
 *                         page's `vp` (PageViewport).
 *
 *  After a mutating edit (both actions are on the controller from useReader()):
 *   • in-place annotation add/update/delete → `bumpRenderEpoch()`
 *   • structural change (reorder/insert/delete) or `await doc.save()` →
 *     `await reloadDocument()`
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useFileDialog, useOpenIntent, useUnsavedGuard, type OpenedFile } from '@imbatranim/ui'
import { Download, FileText } from 'lucide-react'
import { ReaderContext, useReader } from './app/context'
import { useEditor } from './editor/context'
import { useReaderController } from './app/useReaderController'
import { useReplaceGate, type ReplaceLoad } from './app/useReplaceGate'
import { EmptyState } from './app/EmptyState'
import { TopBar } from './shell/TopBar'
import { SidePanel } from './shell/SidePanel'
import type { SidePanelTab } from './shell/SidePanel'
import { Reader } from './reader/Reader'
import { EditorProvider } from './editor/EditorProvider'
import { AnnotateToolbar, FormsPanel, OrganizeView, SignatureDialog } from './lazy'

/**
 * The unsaved-close guard, as a component INSIDE both providers: the dialog's
 * Save-and-close button needs the editor's `saveToDisk` (write-back, or a
 * download for a homeless document — either clears dirty), which
 * `useReaderController` itself cannot reach from outside `EditorProvider`.
 */
function UnsavedCloseGuard(): JSX.Element {
  const { dirty, docName } = useReader()
  const { saveToDisk } = useEditor()
  const unsavedDialog = useUnsavedGuard(dirty, docName, saveToDisk)
  return <>{unsavedDialog}</>
}

export function Pdf({ windowId: _windowId }: { windowId: string }): JSX.Element {
  const ctrl = useReaderController()
  return (
    <ReaderContext.Provider value={ctrl}>
      <EditorProvider>
        <UnsavedCloseGuard />
        <PdfShell />
      </EditorProvider>
    </ReaderContext.Provider>
  )
}

/** The forms tab, appended to the rail. Its panel is a lazy chunk. */
const FORMS_TAB: SidePanelTab = {
  id: 'forms',
  label: 'Forms',
  icon: FileText,
  render: () => <FormsPanel />,
}

/**
 * The shell, INSIDE both providers: every path that replaces the open document
 * goes through `requestReplace`, whose Save button needs the editor's
 * `saveToDisk` (brief 143) — the same reason `UnsavedCloseGuard` lives here.
 */
function PdfShell(): JSX.Element {
  const ctrl = useReader()
  const { saveToDisk, signDialogOpen } = useEditor()
  const { requestReplace, dialog: replaceDialog } = useReplaceGate(
    ctrl.dirty,
    ctrl.docName,
    saveToDisk
  )
  // One-shot open intent, drained by the shared hook (StrictMode-safe).
  const source = useOpenIntent()
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  // Ctrl/Cmd+S (write-back Save) is registered in TopBar, which lives inside
  // EditorProvider and can reach the editor's save-and-reload path.

  /* ── Open an OS-provided file ──────────────────────────────────────────── */
  const openFromOs = ctrl.openFromOs
  const loadSource = useCallback((file: OpenedFile) => openFromOs(file), [openFromOs])

  // Each latched intent is handled once, whatever the answer: Cancel keeps the
  // current document, and the same intent must not ask again on the next render
  // (`requestReplace` changes identity as nothing else here does, but `dirty`
  // flipping re-runs this effect).
  const handledSource = useRef<OpenedFile | null>(null)
  const latestSource = useRef<OpenedFile | null>(null)
  useEffect(() => {
    latestSource.current = source
    if (!source || handledSource.current === source) return
    handledSource.current = source
    requestReplace(() => loadSource(source))
  }, [source, requestReplace, loadSource])

  /* ── Manual open (OS picker + drag-drop) ───────────────────────────────── */
  // The OS's own Open dialog, browsing the CONTAINER's filesystem. It used to be
  // a native `<input type="file">`, which reads the *host* machine — the one
  // thing brief 54 rules out by name, because "the computer is the container"
  // and a dialog that browses the user's laptop instead of their home directory
  // is actively wrong here. The pick latches into the same store `useOpenIntent`
  // reads, so it runs the identical load path a File Manager double-click does.
  const { openFile: pickFromOs } = useFileDialog()
  const pickFile = useCallback(() => {
    void (async () => {
      const before = latestSource.current
      const choice = await pickFromOs({ extensions: ['pdf'] })
      // Picking the file that is already latched (the open one, or one whose
      // replace was cancelled) does not change the latch, so the effect above
      // never sees it. Ask directly instead.
      if (choice && before && choice.root === before.root && choice.path === before.path) {
        requestReplace(() => loadSource(choice))
      }
    })()
  }, [pickFromOs, requestReplace, loadSource])

  const takeFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return
      const load: ReplaceLoad = () => ctrl.openFile(file)
      requestReplace(load)
    },
    [ctrl, requestReplace]
  )

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }, [])
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }, [])
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const file = Array.from(e.dataTransfer.files).find(
        (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
      )
      takeFile(file)
    },
    [takeFile]
  )

  // Mounted from the first time it is asked for, so it can animate closed.
  const [signMounted, setSignMounted] = useState(false)
  if (signDialogOpen && !signMounted) setSignMounted(true)

  const opened = ctrl.render !== null
  // The editing tools arrive with the engine, after the first page.
  const tools = ctrl.doc !== null

  return (
    <>
      {replaceDialog}
      <div
        className="bg-surface-container-lowest relative flex h-full min-h-0 flex-col"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 1. The annotate toolbar row: its height is kept from the first frame. */}
        <TopBar
          onOpenClick={pickFile}
          toolbarSlot={
            opened ? (
              tools ? (
                <Suspense fallback={null}>
                  <AnnotateToolbar />
                </Suspense>
              ) : null
            ) : undefined
          }
        />

        <div className="flex min-h-0 flex-1">
          {/* 2. The forms tab appends to the side panel via `extraTabs`. */}
          {opened && ctrl.panelOpen && <SidePanel extraTabs={[FORMS_TAB]} />}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!opened ? (
              <EmptyState onOpenClick={pickFile} error={ctrl.error} loading={ctrl.loading} />
            ) : ctrl.mode === 'organize' && tools ? (
              /* 3. The organize view replaces the reader here. */
              <div className="min-h-0 flex-1" data-slot="organize-view">
                <Suspense fallback={null}>
                  <OrganizeView />
                </Suspense>
              </div>
            ) : (
              <Reader />
            )}
          </main>
        </div>

        {/* 4. The signature pad (Sign tool + form signature fields), loaded when first asked for. */}
        {signMounted && (
          <Suspense fallback={null}>
            <SignatureDialog />
          </Suspense>
        )}

        {dragging && (
          <div
            className="border-primary bg-surface/80 pointer-events-none absolute inset-2 z-50 grid place-items-center border-2 border-dashed backdrop-blur-sm"
            aria-hidden="true"
          >
            <div className="text-on-surface flex flex-col items-center gap-2">
              <Download size={34} strokeWidth={1.5} />
              <p className="font-ui text-[13px]">Drop a PDF to open</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
