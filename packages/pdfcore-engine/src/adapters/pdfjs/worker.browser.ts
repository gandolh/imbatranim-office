import { GlobalWorkerOptions } from "pdfjs-dist";
import { installMapGetOrInsert } from "./mapGetOrInsert.js";

/**
 * Browser pdf.js worker ownership.
 *
 * The engine OWNS the pdf.js worker so consumers — the web demo AND the
 * imbatranim-office PDF app — never re-wire it and never fetch worker assets
 * from a CDN.
 *
 * ── Vendoring approach (changed 2026-10-21, imbatranim-office brief 06) ─────
 * One worker per page, started from the engine's own entry file
 * (`browser/pdf.worker.ts`), and one `PDFWorker` over it that every document
 * is opened on (`getDocument({ worker })`, see `document.ts` and
 * `browser/pdf-worker.ts` for why not `workerSrc` or `workerPort`). Every
 * modern bundler (Vite, webpack 5, Rollup) emits
 * `new Worker(new URL(<relative>, import.meta.url))` as a file in the
 * CONSUMER's output, library builds included:
 *   • single source of truth — the worker ships straight from the installed
 *     `pdfjs-dist`, always version-matched to the API build;
 *   • zero-dependency, self-hosted — no CDN, no `blob:` or `data:` worker;
 *   • one worker for every document on the page;
 *   • nothing for the consumer to configure.
 * The old `workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs",
 * import.meta.url)` was inlined by Vite's library mode as a `data:` URL: the
 * whole worker, base64, inside the engine chunk, and refused by a
 * `script-src 'self'` CSP.
 *
 * Escape hatch: a consumer whose bundler does not understand the URL pattern
 * (or who self-hosts the asset at a known path) can call {@link configureWorker}
 * with an explicit URL BEFORE first use; documents are then opened on a
 * worker of their own from that URL, as before.
 *
 * (WASM note: pdf.js v4+ uses no WASM for the core render/text/outline paths we
 * ship in v1 — only the optional JPEG2000/JBIG2 decoders do, and those are not
 * on the v1 path. imbatranimOS's CSP refuses wasm, so they stay unsupported
 * there.)
 */

/** Explicitly set the worker source (escape hatch). Wins over the shared worker. */
export function configureWorker(src: string): void {
  GlobalWorkerOptions.workerSrc = src;
}

/** Called by the Render path before the first render. */
export function ensureBrowserWorker(): void {
  // This is about the engine's own missing Map methods, not the worker (which
  // `document.ts` hands every document): every render needs them.
  installMapGetOrInsert();
}
