import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  PDFWorker,
} from "pdfjs-dist";
import type { PdfBytes } from "../../api/types.js";
import { sharedPdfWorker } from "../../browser/pdf-worker.js";

/**
 * pdf.js backend resolution.
 *
 * In Node the modern `pdfjs-dist` build references browser globals (`DOMMatrix`
 * etc.) at import time and warns to use the legacy build; in the browser the
 * modern build (with a real worker) is what we want. The choice is the
 * package's own `#pdfjs` subpath import (package.json "imports"): the legacy
 * build under the `node` condition, the modern build everywhere else. Node,
 * Vite and Vitest all resolve it, so a browser bundle never sees the legacy
 * build (until 2026-10-21 both were literal dynamic imports picked at runtime,
 * and a browser build emitted pdf.js's 600 KB legacy build as a chunk no
 * browser ever loads). The surfaces are identical, so both are typed as the
 * modern build (the legacy subpath ships no types of its own).
 *
 * The import is memoised so every adapter (Render, Text, Outline) shares one
 * module instance — important so the browser worker configuration set on
 * `GlobalWorkerOptions` applies to documents loaded here.
 */
type Pdfjs = typeof import("pdfjs-dist");

let backendPromise: Promise<Pdfjs> | undefined;

export function getPdfjs(): Promise<Pdfjs> {
  if (!backendPromise) {
    backendPromise = import("#pdfjs") as Promise<Pdfjs>;
  }
  return backendPromise;
}

/**
 * Parse PDF bytes into a pdf.js document proxy. Shared by the Render, Text and
 * Outline adapters. `getDocument` transfers/detaches its input buffer, so we
 * hand it a fresh copy to leave the caller's bytes intact.
 */
export async function loadPdfjsDocument(
  bytes: PdfBytes,
): Promise<PDFDocumentProxy> {
  return (await loadPdfjsTask(bytes)).promise;
}

/**
 * Like {@link loadPdfjsDocument} but returns the loading TASK, whose
 * `.destroy()` (the proxy has none) releases the worker-side parse. Adapters
 * hold the task so they can dispose it; read the proxy via `task.promise`.
 */
export async function loadPdfjsTask(
  bytes: PdfBytes,
): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(bytes);
  return pdfjs.getDocument({ data, worker: browserWorker(pdfjs) });
}

/**
 * In a browser, the page's one `PDFWorker` (browser/pdf-worker.ts): every
 * document shares it and none owns it. Node has no `Worker` (the legacy build
 * parses on the main thread), and a consumer that set `workerSrc`
 * (`configureWorker`) gets pdf.js's own worker per document.
 */
function browserWorker(pdfjs: Pdfjs): PDFWorker | undefined {
  if (typeof Worker !== "function" || pdfjs.GlobalWorkerOptions.workerSrc) {
    return undefined;
  }
  return sharedPdfWorker(pdfjs);
}

/**
 * Run `fn` against a freshly parsed pdf.js document and ALWAYS destroy it
 * afterward — for one-shot reads (form geometry, annotation seeding) that
 * would otherwise orphan a worker-side document on every call.
 */
export async function withPdfjsDoc<T>(
  bytes: PdfBytes,
  fn: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const task = await loadPdfjsTask(bytes);
  try {
    return await fn(await task.promise);
  } finally {
    void task.destroy();
  }
}
