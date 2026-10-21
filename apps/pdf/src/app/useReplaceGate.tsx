import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { UnsavedChangesDialog } from '@imbatranim/ui'

/** A deferred document load: fetch + adopt, run only once the user agrees. */
export type ReplaceLoad = () => Promise<void>

/**
 * The one gate in front of every path that replaces the open document (brief 143):
 * the Open PDF picker, an open intent from Files, and a drop.
 *
 * All three ended in `adopt()`, which disposes the previous document and clears
 * `dirty`, so an annotated PDF was silently replaced. The close guard
 * (`useUnsavedGuard`) only protects closing the window. A clean document loads
 * straight away; a dirty one asks with the kit's Save / Don't Save / Cancel.
 *
 * A request made while the question is up replaces the pending load: the newest
 * file the user asked for is the one they mean.
 */
export function useReplaceGate(
  dirty: boolean,
  name: string,
  save: () => Promise<void>
): { requestReplace: (load: ReplaceLoad) => void; dialog: ReactNode } {
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  })

  const [pending, setPending] = useState<ReplaceLoad | null>(null)
  const [saving, setSaving] = useState(false)

  const requestReplace = useCallback((load: ReplaceLoad) => {
    if (!dirtyRef.current) {
      void load()
      return
    }
    setPending(() => load)
  }, [])

  // The Save verdict is the committed `dirty`, not the save promise: `saveToDisk`
  // reports its own failure and leaves `dirty` set, and its state updates have
  // not rendered yet when it resolves. The effect only hands the committed value
  // to the waiting handler (the `useUnsavedGuard` precedent).
  const verdictRef = useRef<((stillDirty: boolean) => void) | null>(null)
  const [verdictTick, setVerdictTick] = useState(0)
  useEffect(() => {
    const resolve = verdictRef.current
    if (!resolve) return
    verdictRef.current = null
    resolve(dirty)
  }, [verdictTick, dirty])

  const onSave = useCallback(async () => {
    const load = pending
    setSaving(true)
    try {
      await save()
    } catch {
      // The save path reports its own failures; `dirty` decides.
    }
    const stillDirty = await new Promise<boolean>((resolve) => {
      verdictRef.current = resolve
      setVerdictTick((t) => t + 1)
    })
    setSaving(false)
    setPending(null)
    // A failed save keeps the current document, still dirty, on screen.
    if (!stillDirty && load) await load()
  }, [pending, save])

  const onDiscard = useCallback(() => {
    const load = pending
    setPending(null)
    if (load) void load()
  }, [pending])

  const onCancel = useCallback(() => setPending(null), [])

  const dialog = (
    <UnsavedChangesDialog
      open={pending !== null}
      name={name || 'This document'}
      onSave={() => void onSave()}
      saving={saving}
      onDiscard={onDiscard}
      onCancel={onCancel}
    />
  )
  return { requestReplace, dialog }
}
