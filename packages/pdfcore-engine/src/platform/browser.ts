import type { Platform } from "./types.js";
import { PdfjsRender } from "../adapters/pdfjs/render.js";
import { ensureBrowserWorker } from "../adapters/pdfjs/worker.browser.js";

/**
 * Browser platform binding — Render via pdf.js onto a real canvas. The Render
 * path OWNS the pdf.js worker: `ensureBrowserWorker()` sets
 * `GlobalWorkerOptions.workerSrc` (vendored, zero-CDN) before the first render.
 */
export const platform: Platform = {
  name: "browser",
  createRender: (bytes) => {
    ensureBrowserWorker();
    return new PdfjsRender(bytes);
  },
};
