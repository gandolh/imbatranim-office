// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocEngine, type DocEngine } from './superdoc'

/**
 * SuperDoc, at the module boundary. What is under test is how Docs marks the
 * hidden editor hosts SuperDoc parks under <body>, so the fake builds those
 * nodes for real — wrapper, host, ProseMirror element — the way
 * PresentationEditor's `createHiddenHost` does, and keeps the listeners its
 * presentation is subscribed with.
 */
const sd = vi.hoisted(() => ({
  instances: [] as FakeSuperDoc[],
}))

type Listener = () => void

type FakeSuperDoc = {
  bodyWrapper: HTMLElement
  storyWrapper: HTMLElement | null
  listeners: Map<string, Set<Listener>>
  /** Open a header/footer session the way StoryPresentationSessionManager does. */
  openStory: (opts?: { emit?: boolean }) => void
  /** Close it: the session's teardown removes its wrapper. */
  closeStory: () => void
  emit: (event: string) => void
}

function hiddenHost(extraClass?: string) {
  const wrapper = document.createElement('div')
  wrapper.className = 'presentation-editor__hidden-host-wrapper'
  if (extraClass) wrapper.classList.add(extraClass)
  const host = document.createElement('div')
  host.className = 'presentation-editor__hidden-host'
  const pm = document.createElement('div')
  pm.className = 'ProseMirror'
  pm.setAttribute('contenteditable', 'true')
  host.appendChild(pm)
  wrapper.appendChild(host)
  document.body.appendChild(wrapper)
  return { wrapper, editor: { view: { dom: pm } } }
}

vi.mock('@harbour-enterprises/superdoc', () => {
  class SuperDoc implements FakeSuperDoc {
    bodyWrapper: HTMLElement
    storyWrapper: HTMLElement | null = null
    listeners = new Map<string, Set<Listener>>()
    activeEditor: unknown
    #storyEditor: unknown = null

    constructor(options: { onReady: () => void }) {
      const body = hiddenHost()
      this.bodyWrapper = body.wrapper
      const presentation = {
        editor: body.editor,
        getActiveEditor: () => this.#storyEditor ?? body.editor,
        on: (event: string, fn: Listener) => {
          if (!this.listeners.has(event)) this.listeners.set(event, new Set())
          this.listeners.get(event)?.add(fn)
        },
        off: (event: string, fn: Listener) => {
          this.listeners.get(event)?.delete(fn)
        },
      }
      // The facade's activeEditor is the body editor; the presentation hangs off it.
      this.activeEditor = { ...body.editor, presentationEditor: presentation }
      sd.instances.push(this)
      setTimeout(() => options.onReady(), 0)
    }
    openStory({ emit = true } = {}) {
      this.storyWrapper?.remove()
      const story = hiddenHost('presentation-editor__story-hidden-host-wrapper')
      this.storyWrapper = story.wrapper
      this.#storyEditor = story.editor
      if (emit) this.emit('activeSurfaceChange')
    }
    closeStory() {
      this.storyWrapper?.remove()
      this.storyWrapper = null
      this.#storyEditor = null
      this.emit('activeSurfaceChange')
    }
    emit(event: string) {
      this.listeners.get(event)?.forEach((fn) => fn())
    }
    destroy() {
      this.storyWrapper?.remove()
      this.bodyWrapper.remove()
    }
  }
  return { SuperDoc }
})

const MARK = 'data-editor-ui-surface'
const marked = (el: Element | null | undefined) => !!el?.hasAttribute(MARK)
/** Let jsdom deliver the <body> MutationObserver records and the fake's onReady. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const engines: DocEngine[] = []

async function openWindow() {
  const editor = document.createElement('div')
  document.body.appendChild(editor)
  const ready = vi.fn()
  const engine = await createDocEngine({
    editor,
    toolbar: '#toolbar',
    file: new File([], 'a.docx'),
    onReady: ready,
    onEdit: () => {},
    onError: () => {},
  })
  engines.push(engine)
  await settle()
  expect(ready).toHaveBeenCalledOnce()
  return { engine, superdoc: sd.instances[sd.instances.length - 1] }
}

afterEach(() => {
  engines.splice(0).forEach((engine) => engine.destroy())
  sd.instances.length = 0
  document.body.innerHTML = ''
})

describe('keystrokes stay in their own Docs window', () => {
  it('leaves a lone window exactly as SuperDoc ships it', async () => {
    const { superdoc } = await openWindow()
    expect(marked(superdoc.bodyWrapper)).toBe(false)
  })

  it('marks each window’s own editor host once a second window opens', async () => {
    const a = await openWindow()
    const b = await openWindow()
    await settle()
    expect(marked(a.superdoc.bodyWrapper)).toBe(true)
    expect(marked(b.superdoc.bodyWrapper)).toBe(true)
    const c = await openWindow()
    await settle()
    expect([a, b, c].every((w) => marked(w.superdoc.bodyWrapper))).toBe(true)
    // One marker each, on its own host: the bridge's stale test then skips it.
    expect(document.querySelectorAll(`[${MARK}]`)).toHaveLength(3)
  })

  it('moves the marker to an open header session and back', async () => {
    const a = await openWindow()
    const b = await openWindow()
    await settle()

    b.superdoc.openStory()
    // The session's editor is the one other windows must leave alone; the
    // body's host is unmarked so b's own bridge can still reroute from it.
    expect(marked(b.superdoc.storyWrapper)).toBe(true)
    expect(marked(b.superdoc.bodyWrapper)).toBe(false)
    expect(marked(a.superdoc.bodyWrapper)).toBe(true)

    b.superdoc.closeStory()
    expect(marked(b.superdoc.bodyWrapper)).toBe(true)
  })

  it('follows a switch between headers that emits no surface change', async () => {
    await openWindow()
    const b = await openWindow()
    await settle()
    b.superdoc.openStory()
    const first = b.superdoc.storyWrapper

    b.superdoc.openStory({ emit: false })
    await settle()
    expect(marked(b.superdoc.storyWrapper)).toBe(true)
    expect(marked(first)).toBe(false)
  })

  it('unmarks on close, and the window left alone drops its marker too', async () => {
    const a = await openWindow()
    const b = await openWindow()
    await settle()

    b.engine.destroy()
    await settle()
    expect(b.superdoc.listeners.get('activeSurfaceChange')?.size).toBe(0)
    expect(b.superdoc.listeners.get('headerFooterModeChanged')?.size).toBe(0)
    expect(marked(a.superdoc.bodyWrapper)).toBe(false)
  })

  it('marks a reloaded window’s new host, as a save that reloads makes one', async () => {
    const a = await openWindow()
    const b = await openWindow()
    await settle()
    const before = b.superdoc.bodyWrapper

    // Docs reloads by tearing the engine down and creating a fresh one.
    b.engine.destroy()
    const reloaded = await openWindow()
    await settle()
    expect(before.isConnected).toBe(false)
    expect(marked(reloaded.superdoc.bodyWrapper)).toBe(true)
    expect(marked(a.superdoc.bodyWrapper)).toBe(true)
  })
})
