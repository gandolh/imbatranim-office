/**
 * Browser entry point for `@pdfcore/engine`.
 *
 * Resolved via the package `exports` "browser" condition (Vite/webpack) and the
 * `@pdfcore/engine/browser` subpath. Registers the browser platform binding
 * (Render onto a real canvas; the Render path owns the pdf.js worker) so
 * `PdfDoc.load(bytes)` needs no explicit platform.
 */
import { PdfDoc } from "./api/PdfDoc.js";
import type { PdfBytes } from "./api/types.js";
import { registerPlatform } from "./platform/registry.js";
import { platform } from "./platform/browser.js";

registerPlatform(platform);

export * from "./index.shared.js";

// The pdf.js worker escape hatch (see worker.browser.ts). Consumers whose
// bundler cannot resolve the vendored worker URL may set it explicitly.
export { configureWorker } from "./adapters/pdfjs/worker.browser.js";

/** Load a document from PDF bytes (browser platform). Convenience over PdfDoc.load. */
export function loadPdf(bytes: PdfBytes): Promise<PdfDoc> {
  return PdfDoc.load(bytes, platform);
}

// The selectable text layer (brief 16) — the one genuinely browser-only
// surface over Text/Render. See browser/text-layer.ts for the
// own-layer-vs-pdf.js-TextLayerBuilder decision.
export {
  buildTextLayer,
  toViewTransform,
  layoutTextItems,
  layoutHighlightRects,
} from "./browser/text-layer.js";
export type {
  BuildTextLayerOptions,
  TextLayerHandle,
  TextSpanLayout,
  DomElementLike,
  DomStyleLike,
  DomDocumentLike,
} from "./browser/text-layer.js";
