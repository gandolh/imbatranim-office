import { Download, FilePlus2, FileWarning, Loader2, Presentation } from 'lucide-react'
import { Button } from '@imbatranim/ui'
import type { KitAppProps } from '@imbatranim-office/shared'
import { Editor } from './editor/Editor'
import { useDeckFile } from './shell/useDeckFile'

/**
 * Slides: opens a .pptx, draws it with its own renderer, edits it, and saves
 * it by patching the package in place (corpus/wiki/slides.md). The desktop
 * renders this component in the window, with its own React and kit.
 */
export function App(_props: KitAppProps) {
  const doc = useDeckFile()
  const { state } = doc

  let body
  if (state.kind === 'open') {
    body = (
      <Editor
        key={state.store.id}
        store={state.store}
        file={{
          name: doc.name,
          saving: doc.saving,
          save: () => void doc.save(),
          saveAs: () => void doc.saveAs(),
          newDeck: () => void doc.newDeck(),
          open: () => void doc.open(),
          download: doc.download,
          setBeforeSave: doc.setBeforeSave,
        }}
      />
    )
  } else if (state.kind === 'empty') {
    body = (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 text-center">
        <Presentation size={40} strokeWidth={1} />
        <span className="font-ui text-[12px]">Nothing open</span>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => void doc.open()}>
            Open a presentation
          </Button>
          <Button
            size="sm"
            variant="default"
            className="flex items-center gap-1"
            onClick={() => void doc.newDeck()}
          >
            <FilePlus2 size={12} />
            New presentation
          </Button>
        </div>
      </div>
    )
  } else if (state.kind === 'loading') {
    body = (
      <div className="bg-surface-container-lowest text-on-surface-variant font-ui flex h-full items-center justify-center gap-2 text-[12px]">
        <Loader2 size={16} className="animate-spin" />
        Opening {state.name}…
      </div>
    )
  } else {
    body = (
      <div className="bg-surface-container-lowest text-on-surface-variant flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FileWarning size={40} strokeWidth={1} className="text-error" />
        <span className="font-ui text-on-surface text-[12px] font-semibold">{state.name}</span>
        <span className="font-ui max-w-[360px] text-[12px]">{state.message}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => void doc.open()}>
            Open a .pptx instead
          </Button>
          {state.kind === 'failed' && doc.download && (
            <Button
              size="sm"
              variant="default"
              className="flex items-center gap-1"
              onClick={doc.download}
            >
              <Download size={12} />
              Download
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest font-ui text-on-surface flex h-full min-h-0 flex-col text-[13px]">
      {body}
      {doc.dialogs}
    </div>
  )
}
