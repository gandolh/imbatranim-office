/**
 * Lazy bridge to SuperDoc — the real docx editor with browser-side round-trip.
 * SuperDoc (Vue app + ProseMirror + docx converter) is heavy and only pulled in
 * on first open via dynamic import, so it becomes its own build chunk and never
 * touches the desktop boot bundle. Only `import type` lives at module top level.
 *
 * SuperDoc is AGPL-3.0 — the whole repo is relicensed AGPL-3.0-only to match
 * (see /LICENSE).
 */
import type { SuperDoc as SuperDocClass } from '@harbour-enterprises/superdoc'

/** One hit from {@link DocEngine.search}, opaque apart from being passable back. */
export type DocMatch = { readonly __brand?: 'DocMatch' }

export type DocEngine = {
  /** Export the current document back to docx bytes. */
  exportDocx: () => Promise<ArrayBuffer>
  /**
   * Find every occurrence of `text`, highlighted in the document.
   *
   * SuperDoc's own `search` command; the matches are opaque tokens that
   * {@link goToMatch} resolves back to positions. Returns `[]` when nothing
   * matches and when the engine has no active editor yet.
   */
  search: (text: string, opts?: { caseSensitive?: boolean }) => DocMatch[]
  /**
   * Scroll to and select a match returned by {@link search}, leaving focus
   * where it was: a find box being typed into keeps the next key.
   */
  goToMatch: (match: DocMatch) => void
  /** The document's rendered HTML, for the word count. */
  html: () => string
  /**
   * Monotonic count of every editor update. Save records this before exporting
   * and only clears dirty if it is unchanged once the upload resolves — so edits
   * made mid-save aren't silently clobbered.
   */
  editCount: () => number
  /** Tear down the editor and release its resources. */
  destroy: () => void
}

type CreateDocEngineOptions = {
  /** Element the editor mounts into. */
  editor: HTMLElement
  /** CSS selector (e.g. `#docs-toolbar-<id>`) of the toolbar mount element. */
  toolbar: string
  /** The docx file to load. */
  file: File
  /** Called once the editor is ready and interactive. */
  onReady: () => void
  /** Called on the first content-changing edit (for dirty tracking). */
  onEdit: () => void
  /** Called only if the document genuinely fails to load/parse. */
  onError: (err: unknown) => void
}

/** Every PresentationEditor parks its real ProseMirror editor in one of these, under <body>. */
const HIDDEN_HOST_WRAPPER = 'presentation-editor__hidden-host-wrapper'
/** The extra class on the hidden hosts of header/footer and footnote sessions. */
const STORY_HOST_WRAPPER = 'presentation-editor__story-hidden-host-wrapper'
/** SuperDoc's declarative "this is not a stray editor, leave its input alone". */
const UI_SURFACE = 'data-editor-ui-surface'

/** The slice of SuperDoc's PresentationEditor this file reads, all public API. */
type PresentationLike = {
  editor?: EditorLike
  getActiveEditor?: () => EditorLike
  on?: (event: string, fn: () => void) => void
  off?: (event: string, fn: () => void) => void
}
type EditorLike = { view?: { dom?: Element | null } | null } | null | undefined

/** The facade's `activeEditor` points at the editor; its presentation hangs off it. */
function presentationOf(editor: unknown): PresentationLike | null {
  if (!editor || typeof editor !== 'object') return null
  const candidate = editor as PresentationLike & { presentationEditor?: PresentationLike | null }
  if (typeof candidate.getActiveEditor === 'function') return candidate
  return candidate.presentationEditor ?? null
}

/**
 * Keep keystrokes in the window they were typed in when several SuperDoc
 * instances share the page, as Docs windows do on the desktop.
 *
 * Each instance's PresentationInputBridge listens on `window` in the capture
 * phase (`useWindowFallback: true`, hard-coded in PresentationEditor's
 * `#setupInputBridge`, not an option). Its `#resolveStaleEditorOrigin` reads
 * any `.ProseMirror[contenteditable="true"]` that is not its own active editor
 * as its own stale one, so it pulls focus back to its editor and swallows the
 * key: typing in one window reached none. Before that test it returns early for
 * events inside a UI surface (`isInRegisteredSurface`: an element carrying
 * `data-editor-ui-surface`, the declarative half of uiSurfaceRegistry.ts; the
 * WeakSet half, `registerUiSurface`, is not exported). So the wrapper holding
 * this instance's active editor carries the marker, and every other instance
 * leaves its input alone.
 *
 * The marker follows the active editor rather than sitting on every wrapper:
 * while a header/footer or footnote session is open, the body's wrapper goes
 * unmarked, because the bridge's own rerouting of keystrokes from a body editor
 * that kept native focus into the open session is what that stale test is for.
 * The instance's own bridge never needed the marker on its active editor
 * (`#isEventOnActiveTarget` answers first), so in body mode nothing it does
 * changes.
 *
 * With one SuperDoc on the page nothing is marked at all. The attribute has
 * readers besides the bridge (the format painter's keyboard-selection handler,
 * and the selection overlay's "focus is on editor UI" check, which is why a
 * Docs window that loses focus to another keeps painting its caret), and a
 * lone window has no one to steal its keystrokes, so it behaves exactly as
 * SuperDoc ships it.
 *
 * Re-synced when the active surface changes and whenever <body>'s children
 * change: hidden hosts are added and removed there as instances and story
 * sessions come and go, and switching between two headers emits no surface
 * change. Returns the teardown.
 */
function keepInputInItsWindow(presentation: PresentationLike, doc: Document): () => void {
  let marked: Element | null = null
  const wrapperOf = (editor: EditorLike) =>
    editor?.view?.dom?.closest?.(`.${HIDDEN_HOST_WRAPPER}`) ?? null
  const sync = () => {
    const instances = doc.querySelectorAll(
      `.${HIDDEN_HOST_WRAPPER}:not(.${STORY_HOST_WRAPPER})`
    ).length
    const next =
      instances > 1
        ? (wrapperOf(presentation.getActiveEditor?.()) ?? wrapperOf(presentation.editor))
        : null
    if (marked && marked !== next) marked.removeAttribute(UI_SURFACE)
    next?.setAttribute(UI_SURFACE, '')
    marked = next
  }
  const surfaceEvents = ['activeSurfaceChange', 'headerFooterModeChanged']
  surfaceEvents.forEach((event) => presentation.on?.(event, sync))
  const observer = new MutationObserver(sync)
  observer.observe(doc.body, { childList: true })
  sync()
  return () => {
    observer.disconnect()
    surfaceEvents.forEach((event) => presentation.off?.(event, sync))
    marked?.removeAttribute(UI_SURFACE)
    marked = null
  }
}

export async function createDocEngine(opts: CreateDocEngineOptions): Promise<DocEngine> {
  // SuperDoc's stylesheet is not imported here: the suite's build refuses CSS
  // imported from JS. apps/docs/package.json declares it as a vendor stylesheet,
  // emitted beside app.css as docs/superdoc.css and added by the desktop from
  // the descriptor's `styles` before this window renders.
  const { SuperDoc } = await import('@harbour-enterprises/superdoc')

  let readyFired = false
  let editCount = 0
  let releaseInput: (() => void) | null = null
  const superdoc: SuperDocClass = new SuperDoc({
    selector: opts.editor,
    toolbar: opts.toolbar,
    document: opts.file,
    documentMode: 'editing',
    // SuperDoc defaults to `telemetry: { enabled: true }` and POSTs to
    // `https://ingest.superdoc.dev/v1/collect` on every document open. The
    // desktop's CSP (`connect-src 'self'`) already refuses it — that refusal is
    // how it was found — but blocking an outbound call the app deliberately
    // makes is the wrong layer to rely on: a deployment behind a proxy that
    // relaxes the CSP would start leaking. The user's documents are their own,
    // and nothing about opening one should reach a third party.
    telemetry: { enabled: false },
    onReady: () => {
      if (!readyFired) {
        readyFired = true
        const presentation = presentationOf(superdoc.activeEditor)
        if (presentation) {
          releaseInput = keepInputInItsWindow(presentation, opts.editor.ownerDocument)
        }
        opts.onReady()
      }
    },
    onEditorUpdate: () => {
      editCount++
      opts.onEdit()
    },
    // Only a genuine content/parse failure is fatal. `onException` fires for a
    // range of internal, often-benign conditions (incl. during export), so it is
    // logged, not surfaced as an "open failed" error.
    onContentError: ({ error }) => opts.onError(error),
    onException: (params) => console.warn('[docs] superdoc exception', params),
  })

  return {
    exportDocx: async () => {
      const blob = await superdoc.export({ exportType: ['docx'], triggerDownload: false })
      return blob.arrayBuffer()
    },
    search: (text, opts) => {
      // The facade's `search` takes only a pattern, so case sensitivity is
      // expressed as a RegExp flag rather than an option — and the user's text is
      // escaped first, or a search for "a.b" would match "axb" and a stray "("
      // would throw a SyntaxError mid-typing.
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(escaped, opts?.caseSensitive ? 'g' : 'gi')
      // Returns undefined when there is no active editor or the active projection
      // has no search command — both mean "no matches" here, not an error.
      return (superdoc.search(pattern) ?? []) as DocMatch[]
    },
    goToMatch: (match) => {
      // SuperDoc's `goToSearchResult` command calls `editor.view.focus()` before
      // it selects the match (1.46.3, `dist/chunks/src-*.es.js`, the Search
      // extension's commands), so in a find-as-you-type box every key after the
      // first went into the document. Hand focus back to whatever held it, in
      // the same task: no key event can run between the two. A selection-only
      // transaction does not reach `onEditorUpdate` (SuperDoc emits "update" on
      // `docChanged` only), so the document stays clean.
      const doc = opts.editor.ownerDocument
      const before = doc.activeElement
      superdoc.goToSearchResult(match as Parameters<typeof superdoc.goToSearchResult>[0])
      if (before instanceof HTMLElement && before !== doc.body && doc.activeElement !== before) {
        before.focus({ preventScroll: true })
      }
    },
    // getHTML returns one entry per editor; a docx is one document, so join
    // rather than assume [0] — a multi-editor future would silently under-count.
    html: () => (superdoc.getHTML() ?? []).join('\n'),
    editCount: () => editCount,
    destroy: () => {
      releaseInput?.()
      releaseInput = null
      try {
        superdoc.destroy()
      } catch {
        // best-effort teardown
      }
    },
  }
}
