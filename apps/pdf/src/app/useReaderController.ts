/**
 * The reader controller hook — owns all shell state and exposes the actions the
 * shell and Part B drive. One instance lives at the Pdf root and is shared via
 * {@link ReaderContext}.
 *
 * Opening a document is two steps (brief 06, the fast first page):
 *  1. pdf.js alone parses the bytes and measures page 1 (`openFirstPage`):
 *     that is enough for `render`, the page count and the layout, so the
 *     reader draws the first page with nothing else loaded.
 *  2. Once a page is on screen (`painted`), the engine loads and opens the
 *     same bytes (`PdfDoc.load`, a pdf-lib parse) with the reader's renderer
 *     as its platform, so `doc.render` is the document already drawn. Only
 *     then do the text layer, search, outline and the editing tools work.
 *
 * Design notes for Part B:
 *  • The engine's document is a single `PdfDoc` (`doc`). It is mutated in place
 *    by the editor capabilities (`doc.annotate`, `doc.forms`, `doc.pages`, …).
 *    The engine's read caches (render/text/outline) re-parse after `doc.save()`.
 *  • After an in-place annotation edit, call `bumpRenderEpoch()` to re-render.
 *  • After a structural edit + `await doc.save()`, and after every save, call
 *    `reloadDocument()` (the cache contract).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fileName, useSystem } from '@imbatranim/ui'
import type { DocumentMetadata, OutlineNode, PdfDoc, Render } from '@pdfcore/engine'
import { openFirstPage, PageRender, readerPlatform } from '../reader/pdfjs'
import { loadEngine, type Engine } from './engine'
import type {
  FitMode,
  PageDim,
  PanelTab,
  ReaderController,
  SaveTarget,
  SearchState,
  ViewMode,
} from './types'

/** Points → CSS px factor at 100% ("actual size", 72pt/in vs 96px/in). */
export const ACTUAL = 96 / 72
/** Zoom steps of 25 points of percentage, as PDF Viewer's (brief 06 folds its zoom in). */
const ZOOM_STEP = 0.25
export const MIN_SCALE = 0.25 * ACTUAL
export const MAX_SCALE = 8 * ACTUAL

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/**
 * The next zoom up or down from `scale` on the 25% ladder: from a fitted 137%,
 * in goes to 150% and out to 125%.
 */
export function steppedScale(scale: number, direction: 1 | -1): number {
  const pct = scale / ACTUAL
  const onGrid = Math.round(pct / ZOOM_STEP) * ZOOM_STEP
  const exact = Math.abs(onGrid - pct) < 0.005
  const next =
    direction > 0
      ? exact
        ? onGrid + ZOOM_STEP
        : Math.ceil(pct / ZOOM_STEP) * ZOOM_STEP
      : exact
        ? onGrid - ZOOM_STEP
        : Math.floor(pct / ZOOM_STEP) * ZOOM_STEP
  return clampScale(next * ACTUAL)
}

const EMPTY_SEARCH: SearchState = {
  query: '',
  hits: [],
  activeIndex: -1,
  busy: false,
  ran: false,
}

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Every page's size in points, rotation and crop box applied, from pdf.js. Null if it cannot tell. */
async function measurePages(render: Render): Promise<PageDim[] | null> {
  if (!(render instanceof PageRender)) return null
  try {
    return (await render.pageSizes()).map((s) => ({ ...s, measured: true }))
  } catch {
    return null
  }
}

/** What the engine opens once the first page is on screen. */
type PendingOpen = { openId: number; bytes: Uint8Array; first: PageRender }

export function useReaderController(): ReaderController {
  const system = useSystem()
  const [render, setRender] = useState<Render | null>(null)
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [painted, setPainted] = useState(false)
  const [docName, setDocName] = useState('')
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pageCount, setPageCount] = useState(0)
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null)
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [pageDims, setPageDims] = useState<PageDim[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [scrollRequest, setScrollRequest] = useState<{
    page: number
    nonce: number
  } | null>(null)
  const [scale, setScaleState] = useState(ACTUAL)
  const [fitMode, setFitModeState] = useState<FitMode>('width')

  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<PanelTab>('thumbnails')
  const [mode, setMode] = useState<ViewMode>('read')

  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH)
  const [renderEpoch, setRenderEpoch] = useState(0)

  // A monotonic open id, so a slow earlier open cannot clobber a newer one. Each
  // `openBytes` claims the next id and only adopts / reports failure if it is
  // still the latest when its parse resolves (L2). `openSeq` is the id of the
  // open on screen, as state, so the engine step re-runs for each one.
  const openIdRef = useRef(0)
  const [openSeq, setOpenSeq] = useState(0)
  const pendingRef = useRef<PendingOpen | null>(null)

  // Release each document's pdf.js parse (worker-side memory) when it is
  // replaced or the window closes (T2-10). As effects, so the pages still
  // drawing from the old one have unmounted first. Both are idempotent, and
  // re-parse if touched again.
  useEffect(() => () => render?.dispose(), [render])
  useEffect(() => () => doc?.dispose(), [doc])

  // Latest search state, read outside the `setSearch` updater in
  // `reloadDocument` — running a search inside an updater double-fires under
  // StrictMode (L7).
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  }, [search])

  const editCountRef = useRef(0)
  const markDirty = useCallback(() => {
    editCountRef.current += 1
    setDirty(true)
  }, [])
  const editCount = useCallback(() => editCountRef.current, [])
  const markSaved = useCallback(() => setDirty(false), [])
  const reportPainted = useCallback(() => setPainted(true), [])
  const setSavedVersion = useCallback((version: string | null) => {
    setSaveTarget((t) => (t ? { ...t, version } : t))
  }, [])

  // The unsaved-close guard lives in Pdf's <UnsavedCloseGuard/> (inside
  // EditorProvider), not here: its Save-and-close button needs the editor's
  // saveToDisk, which this controller cannot reach from outside the provider.

  /* ── Open: step 1, pdf.js and page 1 ───────────────────────────────────── */
  const openBytes = useCallback(
    async (bytes: Uint8Array, name: string, target: SaveTarget | null = null) => {
      const openId = ++openIdRef.current
      setLoading(true)
      setError(null)
      try {
        const first = await openFirstPage(bytes)
        // A newer open started while this one was loading — drop this result so
        // the slower, older document can't replace the newer one.
        if (openId !== openIdRef.current) {
          first.render.dispose()
          return
        }
        pendingRef.current = { openId, bytes, first: first.render }
        setOpenSeq(openId)
        setRender(first.render)
        setDoc(null)
        setEngineError(null)
        setPainted(false)
        setDocName(name)
        setSaveTarget(target)
        setDirty(false)
        setPageCount(first.pageCount)
        setMetadata(null)
        setOutline([])
        // Page 1's size stands in for every page until they are measured.
        setPageDims(
          Array.from({ length: first.pageCount }, (_, i) => ({
            ...first.size,
            measured: i === 0,
          }))
        )
        setCurrentPage(1)
        setSearch(EMPTY_SEARCH)
        setMode('read')
        setRenderEpoch((e) => e + 1)
        setScrollRequest({ page: 1, nonce: Date.now() })
      } catch (err) {
        if (openId !== openIdRef.current) return
        pendingRef.current = null
        setRender(null)
        setDoc(null)
        setPageCount(0)
        setSaveTarget(null)
        setError(`Could not open “${name}”: ${msgOf(err)}`)
      } finally {
        if (openId === openIdRef.current) setLoading(false)
      }
    },
    []
  )

  /* ── Open: step 2, the engine, after the first page is on screen ──────── */
  useEffect(() => {
    const pending = pendingRef.current
    if (!painted || !pending || pending.openId !== openSeq) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const start = () => {
      if (pendingRef.current !== pending) return
      pendingRef.current = null
      void (async () => {
        const current = () => openIdRef.current === pending.openId
        // Exact page sizes from pdf.js (rotation and crop box applied), on
        // the worker while the engine's chunk loads.
        const sizes = measurePages(pending.first)
        try {
          const loaded = await loadEngine()
          const engineDoc = await loaded.PdfDoc.load(pending.bytes, readerPlatform(pending.first))
          if (!current()) return
          setEngine(loaded)
          setDoc(engineDoc)
          setMetadata(engineDoc.metadata())
          void engineDoc.outline
            .tree()
            .then((tree) => {
              if (current()) setOutline(tree)
            })
            .catch(() => {
              if (current()) setOutline([])
            })
        } catch (err) {
          if (!current()) return
          const reason = msgOf(err)
          setEngineError(reason)
          system.notify({
            title: 'Opened read-only',
            body: `This PDF can be read but not searched, annotated or saved: ${reason}`,
            level: 'warning',
          })
        }
        const measured = await sizes
        if (measured && current()) setPageDims(measured)
      })()
    }
    // rAF runs just before the next paint; a task queued from it runs after
    // that paint, so the page is on screen before pdf-lib parses the file. A
    // hidden browser tab runs no frames, so a plain timeout starts it anyway.
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(start, 0)
    })
    const fallback = setTimeout(start, 500)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      clearTimeout(fallback)
    }
  }, [painted, openSeq, system])

  const openFile = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await openBytes(bytes, file.name)
    },
    [openBytes]
  )

  const openFromOs = useCallback(
    async (file: { root: string; path: string }) => {
      setLoading(true)
      try {
        const { bytes, version } = await system.fs.readWithVersion(file.root, file.path)
        // Retain the source as the write-back target: Save writes back here,
        // with the version read, rather than only offering a download.
        await openBytes(new Uint8Array(bytes), fileName(file.path, 'document.pdf'), {
          root: file.root,
          path: file.path,
          version,
        })
      } catch (err) {
        setLoading(false)
        system.notify({ title: 'Could not open PDF', body: msgOf(err), level: 'error' })
      }
    },
    [openBytes, system]
  )

  const reportPageDim = useCallback((index0: number, w: number, h: number) => {
    setPageDims((prev) => {
      const cur = prev[index0]
      if (cur && cur.measured && Math.abs(cur.w - w) < 0.5 && Math.abs(cur.h - h) < 0.5) {
        return prev // no meaningful change — avoid a reflow loop
      }
      const next = prev.slice()
      next[index0] = { w, h, measured: true }
      return next
    })
  }, [])

  /* ── Navigation ────────────────────────────────────────────────────────── */
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.min(Math.max(1, page), Math.max(1, pageCount))
      setScrollRequest({ page: clamped, nonce: Date.now() })
    },
    [pageCount]
  )

  /* ── Zoom / fit ────────────────────────────────────────────────────────── */
  const setScale = useCallback((next: number, nextMode: FitMode = 'custom') => {
    setScaleState(clampScale(next))
    setFitModeState(nextMode)
  }, [])

  const setFitMode = useCallback((m: FitMode) => {
    setFitModeState(m)
    if (m === 'actual') setScaleState(ACTUAL)
  }, [])

  const zoomIn = useCallback(() => {
    setScaleState((s) => steppedScale(s, 1))
    setFitModeState('custom')
  }, [])

  const zoomOut = useCallback(() => {
    setScaleState((s) => steppedScale(s, -1))
    setFitModeState('custom')
  }, [])

  // The Reader computes the actual scale for width/page fits and reports it so
  // the zoom indicator stays truthful without the controller knowing viewport
  // dimensions.
  const reportFitScale = useCallback((next: number) => {
    setScaleState((prev) => (Math.abs(prev - next) < 0.001 ? prev : clampScale(next)))
  }, [])

  /* ── Panels ────────────────────────────────────────────────────────────── */
  const togglePanel = useCallback(() => setPanelOpen((o) => !o), [])

  /* ── Search ────────────────────────────────────────────────────────────── */
  const runSearch = useCallback(
    async (query: string) => {
      const q = query.trim()
      if (!doc || !q) {
        setSearch({ ...EMPTY_SEARCH, query })
        return
      }
      setSearch((s) => ({ ...s, query, busy: true }))
      try {
        const hits = await doc.text.search(q, {})
        setSearch({
          query,
          hits,
          activeIndex: hits.length ? 0 : -1,
          busy: false,
          ran: true,
        })
        if (hits[0]) setScrollRequest({ page: hits[0].page, nonce: Date.now() })
      } catch (err) {
        setError(`Search failed: ${msgOf(err)}`)
        setSearch({ query, hits: [], activeIndex: -1, busy: false, ran: true })
      }
    },
    [doc]
  )

  const clearSearch = useCallback(() => setSearch(EMPTY_SEARCH), [])

  const gotoHit = useCallback((index: number) => {
    setSearch((s) => {
      if (!s.hits.length) return s
      const wrapped = ((index % s.hits.length) + s.hits.length) % s.hits.length
      const hit = s.hits[wrapped]
      if (hit) setScrollRequest({ page: hit.page, nonce: Date.now() })
      return { ...s, activeIndex: wrapped }
    })
  }, [])

  const nextHit = useCallback(() => {
    setSearch((s) => {
      if (!s.hits.length) return s
      const wrapped = (s.activeIndex + 1 + s.hits.length) % s.hits.length
      const hit = s.hits[wrapped]
      if (hit) setScrollRequest({ page: hit.page, nonce: Date.now() })
      return { ...s, activeIndex: wrapped }
    })
  }, [])

  const prevHit = useCallback(() => {
    setSearch((s) => {
      if (!s.hits.length) return s
      const wrapped = (s.activeIndex - 1 + s.hits.length) % s.hits.length
      const hit = s.hits[wrapped]
      if (hit) setScrollRequest({ page: hit.page, nonce: Date.now() })
      return { ...s, activeIndex: wrapped }
    })
  }, [])

  /* ── Re-sync after edits (Part B) ──────────────────────────────────────── */
  const bumpRenderEpoch = useCallback(() => setRenderEpoch((e) => e + 1), [])

  const reloadDocument = useCallback(async () => {
    if (!doc) return
    // The cache contract: `save()` dropped the engine's read caches, so this is
    // a fresh renderer over the saved bytes; the old one is released by the
    // effect above once the pages drawn from it are gone.
    const nextRender = doc.render
    const count = doc.pageCount()
    const dims =
      (await measurePages(nextRender)) ??
      doc.pageSizes().map((s) => ({ w: s.width, h: s.height, measured: false }))
    setRender(nextRender)
    setPageCount(count)
    setMetadata(doc.metadata())
    setPageDims(dims)
    setCurrentPage((p) => Math.min(p, Math.max(1, count)))
    try {
      setOutline(await doc.outline.tree())
    } catch {
      setOutline([])
    }
    // Re-run any active search against the new bytes. Read the latest search
    // from a ref and act on it OUTSIDE any `setSearch` updater — kicking off a
    // search inside an updater double-fires under StrictMode (L7).
    const current = searchRef.current
    if (current.ran && current.query.trim()) void runSearch(current.query)
    setRenderEpoch((e) => e + 1)
  }, [doc, runSearch])

  return useMemo<ReaderController>(
    () => ({
      render,
      doc,
      engine,
      engineError,
      painted,
      reportPainted,
      docName,
      pageCount,
      metadata,
      outline,
      pageDims,
      reportPageDim,
      openFile,
      openFromOs,
      openBytes,
      saveTarget,
      setSavedVersion,
      dirty,
      markDirty,
      editCount,
      markSaved,
      loading,
      error,
      currentPage,
      setCurrentPage,
      goToPage,
      scrollRequest,
      scale,
      fitMode,
      setFitMode,
      zoomIn,
      zoomOut,
      setScale,
      reportFitScale,
      panelOpen,
      togglePanel,
      panelTab,
      setPanelTab,
      mode,
      setMode,
      search,
      runSearch,
      clearSearch,
      gotoHit,
      nextHit,
      prevHit,
      bumpRenderEpoch,
      renderEpoch,
      reloadDocument,
    }),
    [
      render,
      doc,
      engine,
      engineError,
      painted,
      reportPainted,
      docName,
      pageCount,
      metadata,
      outline,
      pageDims,
      reportPageDim,
      openFile,
      openFromOs,
      openBytes,
      saveTarget,
      setSavedVersion,
      dirty,
      markDirty,
      editCount,
      markSaved,
      loading,
      error,
      currentPage,
      goToPage,
      scrollRequest,
      scale,
      fitMode,
      setFitMode,
      zoomIn,
      zoomOut,
      setScale,
      reportFitScale,
      panelOpen,
      togglePanel,
      panelTab,
      mode,
      search,
      runSearch,
      clearSearch,
      gotoHit,
      nextHit,
      prevHit,
      bumpRenderEpoch,
      renderEpoch,
      reloadDocument,
    ]
  )
}
