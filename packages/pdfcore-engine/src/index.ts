/**
 * `@pdfcore/engine` — neutral (common) entry point.
 *
 * The platform-resolved entry points are `index.node.ts` and
 * `index.browser.ts`, selected by the package `exports` conditions / subpaths.
 * This neutral entry binds NO platform: the isomorphic capabilities (Document,
 * Text, Outline, and the write stubs) work, but `doc.render` throws
 * `UnsupportedPlatform` until a platform is bound — import
 * `@pdfcore/engine/browser` or `@pdfcore/engine/node` for rendering.
 */
export * from "./index.shared.js";
