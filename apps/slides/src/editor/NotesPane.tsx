import { useEffect, useRef, useState, type RefObject } from 'react'
import { normalizeNotes } from './notesText'

type Props = {
  slideNumber: number
  /** The slide's notes as saved in the deck. */
  text: string
  /** Write the notes (one undo step). Called on blur, slide change and after a pause in typing. */
  onCommit: (text: string) => void
  /** Set to a function that writes what is typed now (the editor calls it before a save). */
  flushRef?: RefObject<(() => void) | null>
}

/**
 * Speaker notes for the current slide, as plain text. Typing is local until
 * a pause, a blur or a slide change, so the undo history gets one step per
 * stretch of typing rather than one per key.
 */
export function NotesPane({ slideNumber, text, onCommit, flushRef }: Props) {
  const [draft, setDraft] = useState(text)
  const [syncedFrom, setSyncedFrom] = useState({ text, slideNumber })
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  })

  // A new slide, or an undo that changed the notes: show what the deck holds.
  // The draft's own commits come back normalized; those do not reset it, but
  // they are remembered, or the next key typed would look like a change from
  // elsewhere and be thrown away.
  if (syncedFrom.slideNumber !== slideNumber || syncedFrom.text !== text) {
    setSyncedFrom({ text, slideNumber })
    if (syncedFrom.slideNumber !== slideNumber || normalizeNotes(draft) !== text) setDraft(text)
  }

  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const value = pending.current
    pending.current = null
    if (value !== null) commitRef.current(value)
  }

  // Leaving the slide (or closing the pane) writes what was typed.
  useEffect(() => () => flush(), [slideNumber])

  useEffect(() => {
    if (!flushRef) return
    flushRef.current = flush
    return () => {
      flushRef.current = null
    }
  })

  return (
    <div className="border-outline-variant bg-surface-container-low flex h-[28%] min-h-[80px] shrink-0 flex-col border-t px-3 py-2">
      <label
        htmlFor={`notes-${slideNumber}`}
        className="font-ui text-on-surface-variant mb-1 text-[10px] font-semibold tracking-wider uppercase"
      >
        Notes — slide {slideNumber}
      </label>
      <textarea
        id={`notes-${slideNumber}`}
        value={draft}
        placeholder="Click to add notes"
        onChange={(e) => {
          setDraft(e.target.value)
          pending.current = e.target.value
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(flush, 800)
        }}
        onBlur={flush}
        className="font-content text-on-surface placeholder:text-on-surface-variant min-h-0 flex-1 resize-none bg-transparent text-[12px] outline-none"
      />
    </div>
  )
}
