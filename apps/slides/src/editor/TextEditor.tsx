import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import type { ShapeModel } from '../engine/model'
import type { EditParagraph } from '../engine/textEdit'
import { EMU_PER_PT } from '../view/textStyle'
import { stepSize } from './fontSizes'
import { buildEditableText, readEditableText } from '../view/textEditing'

export type TextEditorApi = {
  toggle(command: 'bold' | 'italic' | 'underline'): void
  setSize(size: number | 'up' | 'down'): void
  setColor(hex: string): void
  align(align: 'l' | 'ctr' | 'r' | 'just'): void
  /** What the caret's text looks like now, for the toolbar's toggles. */
  state(): { bold: boolean; italic: boolean; underline: boolean; sizePt: number | null }
  /** Read the text back and end editing. */
  commit(): void
}

type Props = {
  shape: ShapeModel
  /** CSS pixels per EMU inside the drawn slide. */
  scale: number
  /** Where to put the caret: 'end', 'all', or a client point (from the click that started editing). */
  caret: 'end' | 'all' | { x: number; y: number }
  onExit: (paragraphs: EditParagraph[] | null) => void
  onSelectionChange?: () => void
  apiRef: Ref<TextEditorApi | null>
}

const CSS_ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify' } as const

function placeCaret(root: HTMLElement, caret: Props['caret']) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  if (caret === 'all') {
    range.selectNodeContents(root)
  } else if (caret === 'end') {
    range.selectNodeContents(root)
    range.collapse(false)
  } else {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    const hit = doc.caretRangeFromPoint?.(caret.x, caret.y)
    const pos = hit ? null : doc.caretPositionFromPoint?.(caret.x, caret.y)
    if (hit && root.contains(hit.startContainer))
      range.setStart(hit.startContainer, hit.startOffset)
    else if (pos && root.contains(pos.offsetNode)) range.setStart(pos.offsetNode, pos.offset)
    else {
      range.selectNodeContents(root)
      range.collapse(false)
    }
    range.collapse(true)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

/** The paragraph blocks a range touches. */
function blocksIn(root: HTMLElement, range: Range): HTMLElement[] {
  const blocks = [...root.children].filter((c): c is HTMLElement => c instanceof HTMLElement)
  return blocks.filter((b) => range.intersectsNode(b))
}

/**
 * The text of one shape, editable in place. Its content is built once from
 * the model and then left to the browser: the element React renders has no
 * children of its own, so a re-render never touches what the user typed.
 * Ends with Escape, a click elsewhere (the stage calls commit), or unmounting.
 */
export function TextEditor({ shape, scale, caret, onExit, onSelectionChange, apiRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const done = useRef(false)
  const exitRef = useRef(onExit)
  const selRef = useRef(onSelectionChange)
  useEffect(() => {
    exitRef.current = onExit
    selRef.current = onSelectionChange
  })

  const finishWith = (root: HTMLElement | null) => {
    if (done.current) return
    done.current = true
    exitRef.current(root && root.isConnected ? readEditableText(root, shape.text, scale) : null)
  }
  const finish = () => finishWith(rootRef.current)

  /** False between an effect cleanup and the next run: a real unmount, or StrictMode's rehearsal of one. */
  const alive = useRef(false)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    alive.current = true
    const fallback = shape.text?.paragraphs[0] ?? null
    buildEditableText(root, shape.text, scale, fallback)
    root.focus({ preventScroll: true })
    placeCaret(root, caret)
    const onSel = () => {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        savedRange.current = sel.getRangeAt(0).cloneRange()
        selRef.current?.()
      }
    }
    document.addEventListener('selectionchange', onSel)
    return () => {
      document.removeEventListener('selectionchange', onSel)
      alive.current = false
      if (done.current) return
      // Unmounted without a commit (another slide, the window closing): the
      // text is read back now, while the element is in the page and its
      // computed styles are real, and handed over a microtask later unless
      // the effect ran again (StrictMode mounts twice in development).
      const paragraphs = root.isConnected ? readEditableText(root, shape.text, scale) : null
      queueMicrotask(() => {
        if (alive.current || done.current) return
        done.current = true
        exitRef.current(paragraphs)
      })
    }
    // Built once per editing session, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Put the caret back where it was before a toolbar control took focus. */
  const restore = (): Range | null => {
    const root = rootRef.current
    const sel = window.getSelection()
    if (!root || !sel) return null
    if (document.activeElement !== root) root.focus({ preventScroll: true })
    const range = savedRange.current
    if (range && root.contains(range.commonAncestorContainer)) {
      sel.removeAllRanges()
      sel.addRange(range)
      return range
    }
    return sel.rangeCount ? sel.getRangeAt(0) : null
  }

  const pxPerPt = EMU_PER_PT * scale * (shape.text?.fontScale ?? 1)

  useImperativeHandle(apiRef, () => ({
    toggle(command) {
      restore()
      document.execCommand('styleWithCSS', false, 'true')
      document.execCommand(command)
    },
    setSize(size) {
      const range = restore()
      const root = rootRef.current
      if (!range || !root) return
      const current = this.state().sizePt ?? 18
      const pt =
        size === 'up' ? stepSize(current, 1) : size === 'down' ? stepSize(current, -1) : size
      const px = `${Math.round(pt * pxPerPt * 100) / 100}px`
      if (range.collapsed) {
        // No selection: the paragraph the caret is in.
        const block = blocksIn(root, range)[0]
        if (!block) return
        block.style.fontSize = px
        for (const el of block.querySelectorAll<HTMLElement>('span')) el.style.fontSize = px
        return
      }
      const frag = range.extractContents()
      for (const el of frag.querySelectorAll<HTMLElement>('span')) el.style.fontSize = px
      const wrap = document.createElement('span')
      wrap.style.fontSize = px
      // Blocks pulled out whole go back as blocks; inline content gets the wrapper.
      if ([...frag.childNodes].some((n) => n instanceof HTMLElement && n.tagName === 'DIV')) {
        for (const div of frag.querySelectorAll<HTMLElement>('div')) div.style.fontSize = px
        range.insertNode(frag)
      } else {
        wrap.append(frag)
        range.insertNode(wrap)
        const sel = window.getSelection()
        const next = document.createRange()
        next.selectNodeContents(wrap)
        sel?.removeAllRanges()
        sel?.addRange(next)
      }
    },
    setColor(hex) {
      restore()
      document.execCommand('styleWithCSS', false, 'true')
      document.execCommand('foreColor', false, `#${hex}`)
    },
    align(a) {
      const range = restore()
      const root = rootRef.current
      if (!range || !root) return
      for (const b of blocksIn(root, range)) b.style.textAlign = CSS_ALIGN[a]
    },
    state() {
      const sel = window.getSelection()
      const node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null
      const el = node ? (node instanceof Element ? node : node.parentElement) : null
      const root = rootRef.current
      const size =
        el && root?.contains(el) ? parseFloat(getComputedStyle(el).fontSize) / pxPerPt : null
      return {
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        sizePt: size !== null && Number.isFinite(size) ? Math.round(size * 2) / 2 : null,
      }
    },
    commit: finish,
  }))

  return (
    <div
      ref={rootRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="true"
      aria-label={`Text of ${shape.name || 'shape'}`}
      data-text-editor=""
      style={{ outline: 'none', cursor: 'text', caretColor: 'auto' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish()
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          document.execCommand('insertText', false, '\t')
        }
        const mod = e.ctrlKey || e.metaKey
        if (mod && ['e', 'l', 'r', 'j'].includes(e.key.toLowerCase())) {
          e.preventDefault()
          const map = { e: 'ctr', l: 'l', r: 'r', j: 'just' } as const
          const root = rootRef.current
          const sel = window.getSelection()
          if (root && sel?.rangeCount) {
            for (const b of blocksIn(root, sel.getRangeAt(0))) {
              b.style.textAlign = CSS_ALIGN[map[e.key.toLowerCase() as 'e']]
            }
          }
        }
        if (mod && (e.key === ']' || e.key === '[' || e.key === '>' || e.key === '<')) {
          e.preventDefault()
          const api = (apiRef as { current: TextEditorApi | null } | null)?.current
          api?.setSize(e.key === ']' || e.key === '>' ? 'up' : 'down')
        }
        // Keys typed here are the text's, not the stage's shortcuts.
        e.stopPropagation()
      }}
      onPaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        if (text) document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'))
      }}
      onDrop={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}
