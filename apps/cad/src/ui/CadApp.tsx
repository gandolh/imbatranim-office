import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Loader2 } from 'lucide-react'
import { useDocumentedShortcuts } from '@imbatranim/ui'
import type { NativeHostContext } from '@imbatranim-office/shared'
import { useCadFile } from '../shell/useCadFile'
import { CommandLine, type CommandLineHandle } from './CommandLine'
import { LayerDialog } from './LayerDialog'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'
import { Viewport } from './Viewport'

const SHORTCUTS = [
  {
    id: 'office-cad.save',
    keys: 'mod+s',
    description: 'Save the drawing',
    scope: 'Editing' as const,
  },
  {
    id: 'office-cad.undo',
    keys: 'mod+z',
    description: 'Undo the last command',
    scope: 'Editing' as const,
  },
  { id: 'office-cad.redo', keys: 'mod+y', description: 'Redo', scope: 'Editing' as const },
  { id: 'office-cad.ortho', keys: 'f8', description: 'Ortho on or off', scope: 'Editing' as const },
  {
    id: 'office-cad.polar',
    keys: 'f10',
    description: 'Polar tracking on or off',
    scope: 'Editing' as const,
  },
  {
    id: 'office-cad.osnap',
    keys: 'f3',
    description: 'Object snaps on or off',
    scope: 'Editing' as const,
  },
  {
    id: 'office-cad.history',
    keys: 'f2',
    description: 'Show more command history',
    scope: 'Editing' as const,
  },
  {
    id: 'office-cad.cancel',
    keys: 'escape',
    description: 'Cancel the command or clear the selection',
    scope: 'Editing' as const,
  },
]

/** The CAD window: toolbar, drawing area, command line, status bar. */
export function CadApp({ server = null }: { server?: NativeHostContext['server'] }) {
  const file = useCadFile(server)
  const { editor } = file
  const state = useSyncExternalStore(
    (cb) => editor.subscribe((c) => c === 'state' && cb()),
    () => editor.state
  )
  const commandLine = useRef<CommandLineHandle>(null)
  const [layersOpen, setLayersOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const focusCommandLine = useCallback(() => commandLine.current?.focus(), [])

  useEffect(() => editor.handleLayerDialog(() => setLayersOpen(true)), [editor])

  useDocumentedShortcuts(SHORTCUTS)

  const run = (command: string) => {
    editor.run(command)
    focusCommandLine()
  }

  return (
    <div
      className="bg-surface-container-lowest text-on-surface font-ui flex h-full min-h-0 flex-col text-[13px]"
      onKeyDown={(e) => {
        // Keys pressed with focus elsewhere in the window (a toolbar button) still reach the command line.
        const target = e.target as HTMLElement
        if (target.closest('[role="dialog"]') || target.tagName === 'INPUT') return
        if (e.key === 'Escape') {
          editor.cancel()
          focusCommandLine()
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) focusCommandLine()
      }}
    >
      <Toolbar
        state={state}
        name={file.name}
        dirty={file.dirty}
        saving={file.saving}
        exporting={file.exporting}
        onRun={run}
        onZoomExtents={() => {
          editor.zoomExtents()
          focusCommandLine()
        }}
        onNew={() => void file.newDrawing()}
        onOpen={() => void file.open()}
        onSave={() => void file.save()}
        onSaveAs={() => void file.saveAs()}
        onExport={(k) => void file.exportAs(k)}
        onUndo={() => editor.undo()}
        onRedo={() => editor.redo()}
        onLayer={(name) => {
          editor.chooseLayer(name)
          focusCommandLine()
        }}
      />
      {file.error && (
        <div
          className="border-outline-variant bg-error-container text-on-error-container shrink-0 border-b px-2 py-1 text-[12px]"
          role="alert"
        >
          {file.error}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <Viewport editor={editor} onFocusCommandLine={focusCommandLine} />
        {file.loading && (
          <div className="bg-surface-container-lowest text-on-surface-variant absolute inset-0 flex items-center justify-center gap-2 text-[12px]">
            <Loader2 size={16} className="animate-spin" />
            {file.converting ? 'Converting…' : 'Opening drawing…'}
          </div>
        )}
      </div>
      <CommandLine
        ref={commandLine}
        editor={editor}
        state={state}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((x) => !x)}
      />
      <StatusBar editor={editor} state={state} />
      <LayerDialog
        editor={editor}
        state={state}
        open={layersOpen}
        onClose={() => {
          setLayersOpen(false)
          focusCommandLine()
        }}
      />
      {file.dialogs}
    </div>
  )
}
