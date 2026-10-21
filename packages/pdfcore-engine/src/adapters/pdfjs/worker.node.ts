/**
 * Node pdf.js worker setup.
 *
 * In Node we load pdf.js's **legacy** build (see `document.ts`), which runs its
 * parsing on the main thread and needs no `GlobalWorkerOptions.workerSrc` — so
 * there is nothing to wire here. We deliberately avoid a static
 * `import ... from "pdfjs-dist"` in the Node path: the modern build touches
 * browser globals (`DOMMatrix`) at import time and would throw under Node.
 *
 * Kept as an explicit no-op so the platform binding reads symmetrically with
 * the browser one and there is an obvious hook if a Node worker is added later.
 */
export function ensureNodeWorker(): void {
  /* no-op: the legacy build parses on the main thread. */
}
