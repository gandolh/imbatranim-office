/**
 * View-model types for the PDF reader shell. These describe UI state only —
 * all PDF data types come from `@pdfcore/engine`.
 *
 * Ported from the AtelierPDF reference reader; the OS owns the global theme
 * (via `[data-theme]` on `<html>`), so the reader carries no theme state.
 */
import type { DocumentMetadata, OutlineNode, PdfDoc, Render, TextHit } from '@pdfcore/engine'
import type { Engine } from './engine'

/** How the page scale is derived. `custom` = an explicit zoom the user set. */
export type FitMode = 'width' | 'page' | 'actual' | 'custom'

/** Left panel tabs. Part B may register additional tabs (e.g. "forms"). */
export type PanelTab = 'thumbnails' | 'outline' | (string & {})

/**
 * The main-area mode. `read` = the continuous-scroll reader (Part A).
 * `organize` is the page-grid view Part B mounts; the shell reserves it here so
 * the swap point exists without Part A implementing it.
 */
export type ViewMode = 'read' | 'organize' | (string & {})

/** Measured page geometry in PDF points (rotation-aware once a page renders). */
export interface PageDim {
  /** Width in points (already rotation-corrected once measured). */
  w: number
  /** Height in points. */
  h: number
  /** True once a real render viewport refined the estimate. */
  measured: boolean
}

export interface SearchState {
  query: string
  hits: TextHit[]
  /** Index into `hits` of the focused hit, or -1 when none. */
  activeIndex: number
  busy: boolean
  /** Whether a search has been run for the current `query`. */
  ran: boolean
}

/**
 * Where a write-back Save lands: the `{root, path}` of the OS file this document
 * was opened from. `null` for a document with no OS home (a dragged-in `File`),
 * where Save can only export a downloaded copy.
 */
export interface SaveTarget {
  root: string
  path: string
  /**
   * The file's version when it was read or last saved. A save sends it, so a
   * file changed on disk since asks before it is overwritten (the kit's
   * `saveOverRead`, as Docs does). Null when the desktop reports none.
   */
  version: string | null
}

/**
 * The reader controller — the single object Part A and Part B both consume via
 * {@link ReaderContext}. Everything the editor tools need to read state, drive
 * navigation, and re-sync after a mutating edit lives here.
 */
export interface ReaderController {
  /* ── Document ─────────────────────────────────────────────────────────── */
  /**
   * The page renderer (pdf.js only), there as soon as the first page can be
   * drawn. Null while nothing is open. Reading, paging and zoom need nothing
   * else; `doc.render` is this same object once the engine is in.
   */
  render: Render | null
  /**
   * The engine's document (pdf-lib + pdf.js): text layer, search, outline,
   * annotate, forms, organise, sign and save. It loads after the first page is
   * on screen, so it is null for a moment after every open, and stays null for
   * a file pdf.js can show but the engine cannot open (then read-only, see
   * {@link engineError}).
   */
  doc: PdfDoc | null
  /** The engine module (text layer, coordinate helpers), loaded with {@link doc}. */
  engine: Engine | null
  /** Why the engine could not open the document, which stays readable. */
  engineError: string | null
  /**
   * True once a page of the open document is on screen. The rail, the outline,
   * the editing tools and the engine itself wait for it.
   */
  painted: boolean
  /** A page reports its first drawing (or its failure); the first report sets {@link painted}. */
  reportPainted: () => void
  docName: string
  pageCount: number
  metadata: DocumentMetadata | null
  outline: OutlineNode[]
  pageDims: PageDim[]
  /** Reports one page's true (rotated) point size after its first render. */
  reportPageDim: (index0: number, w: number, h: number) => void

  /* ── File I/O ─────────────────────────────────────────────────────────── */
  /** Open from a File (drag-drop from the host) — no OS home, so no write-back. */
  openFile: (file: File) => Promise<void>
  /**
   * Open an OS file: read it with its version and open it with that file as
   * the save target. Failures are reported, never thrown.
   */
  openFromOs: (file: { root: string; path: string }) => Promise<void>
  /**
   * Open from raw bytes. `target` is the OS file a write-back Save lands on;
   * omit it (the drag-drop / File path) to open without a save home.
   */
  openBytes: (bytes: Uint8Array, name: string, target?: SaveTarget | null) => Promise<void>
  /** The OS file a write-back Save lands on, or null for a dragged-in document. */
  saveTarget: SaveTarget | null
  /** Record the version a save wrote, so the next save expects it. */
  setSavedVersion: (version: string | null) => void
  /** True when the document has edits not yet written to {@link saveTarget}. */
  dirty: boolean
  /** Mark the document changed since its last save (arms the unsaved-close guard). */
  markDirty: () => void
  /**
   * How many edits were marked so far. A save compares it before and after, so
   * an edit made while the bytes were on their way keeps the document dirty.
   */
  editCount: () => number
  /** Mark the document saved (clears dirty). */
  markSaved: () => void
  loading: boolean
  error: string | null

  /* ── Navigation & zoom ────────────────────────────────────────────────── */
  currentPage: number
  setCurrentPage: (page: number) => void
  /** Scroll the reader to a 1-based page. `pending` requests survive a not-yet-mounted reader. */
  goToPage: (page: number) => void
  /** A one-shot scroll request the Reader consumes (page + nonce to retrigger). */
  scrollRequest: { page: number; nonce: number } | null
  scale: number
  fitMode: FitMode
  setFitMode: (mode: FitMode) => void
  zoomIn: () => void
  zoomOut: () => void
  setScale: (scale: number, mode?: FitMode) => void
  /** Reader reports its computed scale back when a fit-mode is active. */
  reportFitScale: (scale: number) => void

  /* ── Panels & mode ────────────────────────────────────────────────────── */
  panelOpen: boolean
  togglePanel: () => void
  panelTab: PanelTab
  setPanelTab: (tab: PanelTab) => void
  mode: ViewMode
  setMode: (mode: ViewMode) => void

  /* ── Search ───────────────────────────────────────────────────────────── */
  search: SearchState
  runSearch: (query: string) => Promise<void>
  clearSearch: () => void
  gotoHit: (index: number) => void
  nextHit: () => void
  prevHit: () => void

  /* ── Re-sync after an edit (Part B) ───────────────────────────────────── */
  /**
   * Bump the render epoch so every rendered page + text layer rebuilds. Cheap;
   * use after an in-place annotation edit whose result is already reflected by
   * the engine's read caches.
   */
  bumpRenderEpoch: () => void
  renderEpoch: number
  /**
   * Full re-sync after a mutating edit + `doc.save()` (the cache contract: a
   * save drops the engine's read caches, so the reader must re-read): takes
   * the new `doc.render`, re-reads pageCount, page sizes, metadata and
   * outline, then bumps the render epoch. Part B calls this after page
   * reorder/delete/insert, form-flatten, and every save.
   */
  reloadDocument: () => Promise<void>
}
