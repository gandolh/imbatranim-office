/**
 * `@pdfcore/engine/worker`: the page's one pdf.js worker, started from a file
 * the consumer's bundler emits, and the one `PDFWorker` every document opens
 * on. No pdf.js and no pdf-lib in this module (pdf.js is passed in), so an app
 * can start the worker before it loads either: imbatranim-office's PDF app
 * does, to get its first page up sooner.
 *
 * Why a file: until 2026-10-21 the engine set `GlobalWorkerOptions.workerSrc =
 * new URL("pdfjs-dist/build/…", import.meta.url)`, and a library build (Vite's
 * `build.lib`) inlines a `new URL` asset as a `data:` URL. That put the 1.2 MB
 * worker, base64-encoded, inside the engine's own chunk and handed pdf.js a
 * `data:` worker that a `script-src 'self'` CSP refuses. A
 * `new Worker(new URL(<relative file>, import.meta.url))` is emitted as a file
 * by every bundler that understands workers, library builds included.
 *
 * Why one `PDFWorker`, passed as `getDocument({ worker })`: a document opened
 * that way does not own it, so destroying the document leaves it alone. The
 * other ways to share a worker break here. With `workerSrc`, every document
 * starts a worker of its own (the engine opens three per file: render, text,
 * outline). With `GlobalWorkerOptions.workerPort`, the document that is
 * destroyed takes the shared `PDFWorker` down with it, and a `getDocument`
 * made meanwhile throws "the worker is being destroyed" (pdf.js 6.1); the
 * engine's reloads after a save hit that every time.
 */
import type { PDFWorker } from "pdfjs-dist";

type Pdfjs = typeof import("pdfjs-dist");

let webWorker: Worker | null = null;
let pdfWorker: PDFWorker | null = null;

/** Start the page's pdf.js worker, once. Needs no pdf.js: call it as early as you like. */
export function startPdfjsWorker(): Worker {
  webWorker ??= new Worker(new URL("./pdf.worker.ts", import.meta.url), {
    type: "module",
    name: "pdf.js",
  });
  return webWorker;
}

/**
 * The page's one `PDFWorker`, over {@link startPdfjsWorker}'s worker, for
 * `getDocument({ data, worker })`. Lives as long as the page; never destroy it.
 */
export function sharedPdfWorker(pdfjs: Pdfjs): PDFWorker {
  pdfWorker ??= pdfjs.PDFWorker.create({
    port: startPdfjsWorker(),
    name: "pdf.js",
  });
  return pdfWorker;
}
