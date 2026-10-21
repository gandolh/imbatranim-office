/**
 * Node entry point for `@pdfcore/engine`.
 *
 * Resolved via the package `exports` "node" condition and the
 * `@pdfcore/engine/node` subpath. Registers the Node platform binding (Render
 * via pdf.js on the main thread; the consumer supplies a `@napi-rs/canvas`
 * canvas as the render target) so `PdfDoc.load(bytes)` needs no explicit
 * platform.
 */
import { PdfDoc } from "./api/PdfDoc.js";
import type { PdfBytes } from "./api/types.js";
import { registerPlatform } from "./platform/registry.js";
import { platform } from "./platform/node.js";

registerPlatform(platform);

export * from "./index.shared.js";

/** Load a document from PDF bytes (Node platform). Convenience over PdfDoc.load. */
export function loadPdf(bytes: PdfBytes): Promise<PdfDoc> {
  return PdfDoc.load(bytes, platform);
}
