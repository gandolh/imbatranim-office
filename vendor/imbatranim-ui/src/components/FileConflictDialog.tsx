import { Button } from './Button'
import { Dialog } from './Dialog'

export type FileConflictDialogProps = {
  open: boolean
  /** The file's name, shown in the question. */
  name: string
  /** Disables every button while the chosen action runs. */
  busy?: boolean
  /** Save mine anyway, replacing what is on disk. */
  onOverwrite: () => void
  /** Discard my edits and load what is on disk now. */
  onReload: () => void
  /** Keep editing, saving nothing (for example to copy my text out first). */
  onCancel: () => void
}

/**
 * Asked when a save finds the file changed on disk since the editor read it
 * (brief 155): a `git checkout` in the Terminal, another window, another app.
 * The save has written nothing yet. Esc, backdrop and the title-bar × mean
 * Cancel, and Cancel has the focus: the one answer that loses nothing.
 */
export function FileConflictDialog({
  open,
  name,
  busy = false,
  onOverwrite,
  onReload,
  onCancel,
}: FileConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()} title={name}>
      <p className="text-on-surface mb-4 max-w-[420px]">
        <span className="font-semibold">{name}</span> changed on disk since you opened it. Saving
        now replaces those changes with yours.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="destructive" size="sm" disabled={busy} onClick={onOverwrite}>
          Overwrite
        </Button>
        <Button variant="default" size="sm" disabled={busy} onClick={onReload}>
          Reload from disk
        </Button>
        <Button variant="primary" size="sm" autoFocus disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Dialog>
  )
}
