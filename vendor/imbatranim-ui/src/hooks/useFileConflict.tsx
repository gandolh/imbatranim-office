import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FileConflictDialog } from '../components/FileConflictDialog'

export type FileConflictChoice = 'overwrite' | 'reload' | 'cancel'

export type FileConflict = {
  /** Render it somewhere in the tree, like `useUnsavedGuard`'s dialog. */
  dialog: ReactNode
  /** Ask about `name` and resolve the button pressed. */
  ask: (name: string) => Promise<FileConflictChoice>
}

/**
 * The question a save asks when it meets a `FileConflictError` (brief 155).
 * A promise, so the save path reads top to bottom:
 *
 * ```ts
 * } catch (err) {
 *   if (err instanceof FileConflictError) {
 *     const choice = await conflict.ask(name)
 *     ...
 * ```
 *
 * Unmounting with the question open answers Cancel, which writes nothing.
 */
export function useFileConflict(): FileConflict {
  const [open, setOpen] = useState(false)
  // Kept after closing, so the name does not blank during the exit animation.
  const [name, setName] = useState('')
  const resolverRef = useRef<((choice: FileConflictChoice) => void) | null>(null)

  const answer = useCallback((choice: FileConflictChoice) => {
    resolverRef.current?.(choice)
    resolverRef.current = null
    setOpen(false)
  }, [])

  const ask = useCallback((next: string) => {
    // A second save while the question is open joins nothing: the first
    // question is answered Cancel, and the new one takes its place.
    resolverRef.current?.('cancel')
    setName(next)
    setOpen(true)
    return new Promise<FileConflictChoice>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  useEffect(
    () => () => {
      resolverRef.current?.('cancel')
      resolverRef.current = null
    },
    []
  )

  const dialog = (
    <FileConflictDialog
      open={open}
      name={name}
      onOverwrite={() => answer('overwrite')}
      onReload={() => answer('reload')}
      onCancel={() => answer('cancel')}
    />
  )
  return { dialog, ask }
}
