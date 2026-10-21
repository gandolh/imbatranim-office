import type { Render } from "../capabilities/Render.js";
import type { PdfBytes } from "../api/types.js";

/**
 * The platform seam. With Text now isomorphic (pdf.js on both node and browser,
 * DEC-40), the only genuinely platform-split capability is **Render** — browser
 * canvas vs Node `@napi-rs/canvas`, and pdf.js worker wiring differs. Each
 * platform build provides a `createRender`; everything else in the facade is
 * isomorphic and constructed directly.
 */
export interface Platform {
  /** The environment this build targets — useful for diagnostics. */
  readonly name: "node" | "browser";
  /**
   * Build the Render capability over the given PDF bytes. The browser binding
   * owns pdf.js `GlobalWorkerOptions.workerSrc`; the node binding wires the
   * in-process worker.
   */
  createRender(bytes: PdfBytes): Render;
}
