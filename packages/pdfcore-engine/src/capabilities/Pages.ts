import type { PageSize, PdfBytes } from "../api/types.js";

/** What to insert at a position: a blank page of a given size, or PDF bytes. */
export type PageInsert =
  | { kind: "blank"; size?: PageSize }
  | { kind: "bytes"; bytes: PdfBytes; pages?: number[] };

/**
 * Pages — page-level document surgery (the "Organize" half of Organize &
 * assemble). Mutates the working document so subsequent Render/Text see the new
 * order. Backed by `pdf-lib`.
 *
 * Platform: **common**. Implemented by **brief 11**.
 */
export interface Pages {
  /** Rotate a page by a multiple of 90°, composing with existing rotation. */
  rotate(page: number, degrees: 90 | 180 | 270 | -90 | -180 | -270): void;

  /** Delete one or more pages by 1-based index. */
  delete(pages: number | number[]): void;

  /** Move the page at `fromIndex` (0-based) to `toIndex` (0-based). */
  reorder(fromIndex: number, toIndex: number): void;

  /** Insert a blank page or external bytes at a 0-based index. */
  insert(atIndex: number, what: PageInsert): Promise<void>;

  /**
   * Extract the given 1-based pages, in order, as a new document's bytes.
   * (Returns bytes rather than a `PdfDoc` to keep the interface facade-free;
   * callers `PdfDoc.load` the result.)
   */
  extract(pages: number[]): Promise<PdfBytes>;
}
