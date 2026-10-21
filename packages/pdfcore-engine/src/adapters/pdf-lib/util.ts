import { PDFDocument } from "pdf-lib";
import type { PdfBytes } from "../../api/types.js";

/**
 * Shared pdf-lib helpers used by more than one write adapter. Briefs 11
 * (Pages.extract) and 12 (Assemble.merge/split) share the copy-pages helper
 * here rather than duplicating it (see brief 11/12 "Files you must NOT touch").
 */

/**
 * Copy the given 0-based page indices from `src` into `dest`, appending them in
 * the order requested. Preserves page size and rotation (pdf-lib `copyPages`
 * copies the page's content + resources). Returns `dest`.
 */
export async function copyPagesInto(
  dest: PDFDocument,
  src: PDFDocument,
  indices: number[],
): Promise<PDFDocument> {
  const copied = await dest.copyPages(src, indices);
  for (const page of copied) dest.addPage(page);
  return dest;
}

/**
 * Build a new document containing `indices` (0-based, in order) copied from
 * `src`, and return its serialised bytes. Shared by Pages.extract and
 * Assemble.split.
 */
export async function subsetToBytes(
  src: PDFDocument,
  indices: number[],
): Promise<PdfBytes> {
  const out = await PDFDocument.create();
  await copyPagesInto(out, src, indices);
  return out.save();
}
