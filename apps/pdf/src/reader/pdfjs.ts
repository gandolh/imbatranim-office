/**
 * The fast path to the first page: pdf.js and its worker, and nothing of the
 * engine (pdf-lib), the rail or the editing tools. This is what made PDF Viewer
 * the light app (brief 06; OS brief 65 measured norPDF 1.1 s slower because it
 * parsed the file with pdf-lib and painted its thumbnail rail first).
 *
 * Two things here are faster than PDF Viewer was:
 *  • the worker starts first, from its own file, while the library and the
 *    file's bytes are still loading (PDF Viewer read the file, then imported
 *    pdf.js, then let `getDocument` start the worker, one after the other);
 *  • one worker serves every document of every PDF window (the engine's
 *    shared `PDFWorker`, see packages/pdfcore-engine/src/browser/pdf-worker.ts),
 *    so a second open, the engine's text and outline reads and a reload after
 *    a save start no new worker.
 *
 * {@link PageRender} is the engine's `Render` capability over a pdf.js document
 * (the same code as the engine's `PdfjsRender`). The engine is handed it through
 * {@link readerPlatform} when it loads after the first paint, so `doc.render`
 * is the very document the first page was drawn from: no second parse, and the
 * pages on screen are not drawn again.
 *
 * Only `import type` from pdfjs-dist and the engine's barrel here: both are
 * dynamic imports, kept off the window's first module (see eslint.config.js).
 * `@pdfcore/engine/worker` is the engine's worker file and nothing else.
 */
import { installMapGetOrInsert } from '@imbatranim/ui'
import { sharedPdfWorker, startPdfjsWorker } from '@pdfcore/engine/worker'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type {
  PageViewport,
  Platform,
  Render,
  RenderOptions,
  RenderResult,
  RenderTarget,
} from '@pdfcore/engine'

type Pdfjs = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<Pdfjs> | null = null

/**
 * Start pdf.js and its worker. Idempotent: the first call starts both, later
 * calls get the same library. Call it as soon as a document is on its way.
 */
export function warmUpPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    // The worker script is the largest file on the way to the first page, so
    // it starts loading before the library does. Messages pdf.js posts to it
    // before its module has run wait in the worker's queue.
    startPdfjsWorker()
    // pdf.js 6.1 calls Map.prototype.getOrInsertComputed on every render; on
    // Chrome 141 and earlier every page is blank without it (OS brief 91).
    installMapGetOrInsert()
    const loading = import('pdfjs-dist')
    pdfjsPromise = loading
    loading.catch(() => {
      // A failed chunk load (the window's suite was updated under it) may work
      // on the next try.
      if (pdfjsPromise === loading) pdfjsPromise = null
    })
  }
  return pdfjsPromise
}

/** A pdf.js parse of some bytes, opened through the shared worker. */
async function loadTask(bytes: Uint8Array): Promise<PDFDocumentLoadingTask> {
  const lib = await warmUpPdfjs()
  // getDocument transfers its buffer to the worker; the caller keeps its bytes
  // (the engine parses them again with pdf-lib). The shared worker is passed,
  // not owned: destroying this document leaves it running for the others.
  return lib.getDocument({ data: bytes.slice(), worker: sharedPdfWorker(lib) })
}

/**
 * The engine's `Render` capability over pdf.js, as `PdfjsRender` in
 * packages/pdfcore-engine/src/adapters/pdfjs/render.ts has it, plus `bytes`
 * so {@link readerPlatform} can hand the same instance to the engine.
 */
export class PageRender implements Render {
  readonly bytes: Uint8Array
  #task: PDFDocumentLoadingTask | undefined

  constructor(bytes: Uint8Array, task?: PDFDocumentLoadingTask) {
    this.bytes = bytes
    this.#task = task
  }

  async pageCount(): Promise<number> {
    return (await this.#document()).numPages
  }

  async page(page: number, target: RenderTarget, opts?: RenderOptions): Promise<RenderResult> {
    const doc = await this.#document()
    const pdfPage = await doc.getPage(checkPage(doc, page, 'Render.page'))
    const viewport = pdfPage.getViewport({ scale: opts?.scale ?? 1, rotation: opts?.rotation })
    const ctx = target.getContext('2d')
    if (!ctx) throw new Error('Render.page: target has no 2d context.')
    target.width = Math.ceil(viewport.width)
    target.height = Math.ceil(viewport.height)
    await pdfPage.render({
      canvas: target as never,
      canvasContext: ctx as never,
      viewport,
    }).promise
    return { width: target.width, height: target.height }
  }

  async viewport(page: number, opts?: RenderOptions): Promise<PageViewport> {
    const doc = await this.#document()
    const pdfPage = await doc.getPage(checkPage(doc, page, 'Render.viewport'))
    const scale = opts?.scale ?? 1
    const vp = pdfPage.getViewport({ scale, rotation: opts?.rotation })
    const base = pdfPage.getViewport({ scale: 1, rotation: 0 })
    return {
      width: vp.width,
      height: vp.height,
      pageWidth: base.width,
      pageHeight: base.height,
      scale,
      rotation: vp.rotation,
    }
  }

  /**
   * Every page's size in points at scale 1, rotation and crop box applied:
   * what the reader lays pages out with. pdf-lib's sizes (`doc.pageSizes()`)
   * are the unrotated media box.
   */
  async pageSizes(): Promise<{ w: number; h: number }[]> {
    const doc = await this.#document()
    const pages = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1))
    )
    return pages.map((p) => {
      const vp = p.getViewport({ scale: 1 })
      return { w: vp.width, h: vp.height }
    })
  }

  /** Release the pdf.js document and its worker-side memory. Re-parses if used again. */
  dispose(): void {
    void this.#task?.destroy()
    this.#task = undefined
  }

  async #document(): Promise<PDFDocumentProxy> {
    if (!this.#task) this.#task = await loadTask(this.bytes)
    return this.#task.promise
  }
}

function checkPage(doc: PDFDocumentProxy, page: number, what: string): number {
  if (page < 1 || page > doc.numPages) {
    throw new Error(`${what}: page ${page} out of range (document has ${doc.numPages} page(s)).`)
  }
  return page
}

/** What the reader needs before anything else: a render, the page count, page 1's size. */
export type FirstPage = {
  render: PageRender
  pageCount: number
  /** Page 1's size in points, rotation applied: the estimate for every page until each is drawn. */
  size: { w: number; h: number }
}

/** Parse the bytes with pdf.js only and measure page 1. Throws what pdf.js throws. */
export async function openFirstPage(bytes: Uint8Array): Promise<FirstPage> {
  const task = await loadTask(bytes)
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    return {
      render: new PageRender(bytes, task),
      pageCount: doc.numPages,
      size: { w: vp.width, h: vp.height },
    }
  } catch (err) {
    void task.destroy()
    throw err
  }
}

/**
 * The platform the engine's `PdfDoc.load` gets: `doc.render` over the bytes
 * the reader opened is the reader's own {@link PageRender}; any other bytes
 * (after a `save()`) get a fresh one on the shared worker. It stands in for
 * the engine's browser platform, whose renderer would parse the bytes again.
 */
export function readerPlatform(first: PageRender): Platform {
  return {
    name: 'browser',
    createRender: (bytes) => (bytes === first.bytes ? first : new PageRender(bytes)),
  }
}
