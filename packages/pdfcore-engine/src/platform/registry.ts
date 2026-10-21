import type { Platform } from "./types.js";
import { UnsupportedPlatform } from "../api/errors.js";

/**
 * A tiny platform registry so `PdfDoc.load(bytes)` works with no explicit
 * platform argument: the platform-bound entry points (`index.node.ts` /
 * `index.browser.ts`) call {@link registerPlatform} at import time. The neutral
 * `common` entry (`index.ts`) registers nothing — isomorphic capabilities still
 * work, but `doc.render` throws {@link UnsupportedPlatform} until a platform is
 * bound.
 *
 * Callers may still pass a platform explicitly to `PdfDoc.load` (used by tests
 * and by consumers that mix environments).
 */
let current: Platform | undefined;

export function registerPlatform(platform: Platform): void {
  current = platform;
}

export function getPlatform(): Platform | undefined {
  return current;
}

/** Get the registered platform or throw a clear error naming the subpaths. */
export function requirePlatform(what: string): Platform {
  if (!current) {
    throw new UnsupportedPlatform(
      what,
      "no platform bound; import from '@pdfcore/engine/browser' or " +
        "'@pdfcore/engine/node', or pass a platform to PdfDoc.load()",
    );
  }
  return current;
}
