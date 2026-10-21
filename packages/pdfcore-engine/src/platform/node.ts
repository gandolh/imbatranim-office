import type { Platform } from "./types.js";
import { PdfjsRender } from "../adapters/pdfjs/render.js";
import { ensureNodeWorker } from "../adapters/pdfjs/worker.node.js";

/**
 * Node platform binding — Render via pdf.js on the main thread; consumers
 * supply a `@napi-rs/canvas` canvas as the render target. Wires the in-process
 * pdf.js worker before the first render.
 */
export const platform: Platform = {
  name: "node",
  createRender: (bytes) => {
    ensureNodeWorker();
    return new PdfjsRender(bytes);
  },
};
