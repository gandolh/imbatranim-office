import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@imbatranim/ui'
import type { Editor, EditorState } from '../engine/editor'

export type CommandLineHandle = { focus(): void }

type Props = {
  editor: Editor
  state: EditorState
  /** Show more history lines (F2). */
  expanded: boolean
  onToggleExpanded: () => void
}

/**
 * The command line: recent history, the current prompt with its options as
 * buttons, and the input. Enter or Space sends (Space is a space only while
 * a prompt asks for text); Esc cancels; Up and Down recall what was typed.
 * F3 osnap, F8 ortho, F10 polar, Ctrl+Z / Ctrl+Y undo and redo, Delete erases
 * the selection.
 */
export const CommandLine = forwardRef<CommandLineHandle, Props>(function CommandLine(
  { editor, state, expanded, onToggleExpanded },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const recall = useRef<{ list: string[]; at: number }>({ list: [], at: -1 })
  useImperativeHandle(
    ref,
    () => ({ focus: () => inputRef.current?.focus({ preventScroll: true }) }),
    []
  )

  const send = (text: string) => {
    if (text.trim() !== '') {
      const r = recall.current
      r.list = [...r.list.filter((t) => t !== text), text].slice(-50)
      r.at = -1
    }
    setValue('')
    editor.submit(text)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Enter') {
      e.preventDefault()
      send(value)
      return
    }
    if (e.key === ' ' && !state.wantsText) {
      e.preventDefault()
      send(value)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setValue('')
      editor.cancel()
      return
    }
    if (e.key === 'F2') {
      e.preventDefault()
      onToggleExpanded()
      return
    }
    if (e.key === 'F3') {
      e.preventDefault()
      editor.setToggles({ osnap: !state.toggles.osnap })
      return
    }
    if (e.key === 'F8') {
      e.preventDefault()
      editor.setToggles({ ortho: !state.toggles.ortho })
      return
    }
    if (e.key === 'F10') {
      e.preventDefault()
      editor.setToggles({ polar: !state.toggles.polar })
      return
    }
    if (value === '') {
      if (e.key === 'Delete') {
        e.preventDefault()
        editor.eraseSelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        editor.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        editor.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        editor.selectAll()
        return
      }
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const r = recall.current
      if (r.list.length === 0) return
      e.preventDefault()
      r.at =
        e.key === 'ArrowUp'
          ? r.at < 0
            ? r.list.length - 1
            : Math.max(0, r.at - 1)
          : r.at < 0
            ? -1
            : r.at + 1
      if (r.at >= r.list.length) r.at = -1
      setValue(r.at < 0 ? '' : r.list[r.at])
    }
  }

  const lines = state.history.slice(expanded ? -12 : -3)
  return (
    <div
      className="border-outline-variant bg-surface-container-low font-ui shrink-0 border-t text-[12px]"
      data-testid="cad-command-line"
    >
      <div
        className={cn(
          'text-on-surface-variant flex flex-col justify-end overflow-hidden px-2 pt-0.5',
          expanded ? 'h-[186px]' : 'h-[48px]'
        )}
        role="log"
        aria-label="Command history"
        aria-live="polite"
      >
        {lines.map((l, i) => (
          <div
            key={`${state.history.length - lines.length + i}`}
            className="truncate leading-[15px]"
          >
            {l}
          </div>
        ))}
      </div>
      <div className="border-outline-variant flex items-center gap-1 border-t px-2 py-0.5">
        <span className="text-on-surface shrink-0 font-semibold">{state.prompt}</span>
        {state.keywords.map((k) => (
          <button
            key={k.name}
            type="button"
            className="border-outline-variant text-on-surface hover:bg-surface-container-high focus-visible:ring-primary shrink-0 border px-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => send(k.alias)}
            title={`${k.name} (${k.alias})`}
          >
            {k.name}
          </button>
        ))}
        <input
          ref={inputRef}
          autoFocus
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label="Command line"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          className="bg-surface-container-lowest text-on-surface min-w-[120px] flex-1 border-0 px-1 py-0.5 text-[12px] outline-none"
        />
      </div>
    </div>
  )
})
