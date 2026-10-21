import type { PdfBytes } from "../api/types.js";

/**
 * A split specification: explicit inclusive 1-based page ranges (e.g.
 * `[[1,3],[4,4]]`), or a chunk size to split every N pages.
 */
export type SplitSpec =
  | { ranges: [start: number, end: number][] }
  | { every: number };

/**
 * Assemble — combine and divide documents (the "Assemble" half of Organize &
 * assemble). Backed by `pdf-lib`.
 *
 * Platform: **common**. Implemented by **brief 12** (shares a copy-pages helper
 * in `adapters/pdf-lib/util.ts` with Pages.extract, brief 11).
 */
export interface Assemble {
  /**
   * Append every page of each source (bytes) onto this document, in order.
   * Mutates the working document.
   */
  merge(...sources: PdfBytes[]): Promise<void>;

  /**
   * Split this document into several, one per range / chunk.
   * @returns the bytes of each produced document, in order.
   */
  split(spec: SplitSpec): Promise<PdfBytes[]>;
}
