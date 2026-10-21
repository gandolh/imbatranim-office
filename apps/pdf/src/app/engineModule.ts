// What the app takes from the engine at runtime, in one chunk loaded by
// engine.ts after the first page. Modules on the first page's path import
// only types from '@pdfcore/engine' (eslint.config.js holds them to it).
// The browser entry by name: the text layer exists only there, and a test
// (Vitest resolves the `node` condition) must not get the Node entry.
export { PdfDoc, buildTextLayer, layoutHighlightRects } from '@pdfcore/engine/browser'
