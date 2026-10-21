import type {
  CreateDocOptions,
  DrawTextOptions,
  PageSize,
} from "../api/types.js";

/**
 * Generate — create pages/PDFs from scratch and draw primitives. A foundational
 * primitive kept from the old design (NOT a template pipeline — that Studio
 * layer is dropped). Backed by `pdf-lib`.
 *
 * Platform: **common**. Stubbed in brief 09; fleshed out when a consumer needs
 * document creation.
 */
export interface Generate {
  /** Replace the working document with a fresh blank one. */
  createDoc(opts?: CreateDocOptions): void;

  /** Append a blank page. @returns the new 1-based page count. */
  addPage(size?: PageSize): number;

  /** Draw a text string at a PDF-points position on a page. */
  drawText(text: string, opts: DrawTextOptions): void;
}
