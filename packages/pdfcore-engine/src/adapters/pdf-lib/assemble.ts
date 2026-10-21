import { PDFDocument } from "pdf-lib";
import type { Assemble, SplitSpec } from "../../capabilities/Assemble.js";
import { PdfEngineError } from "../../api/errors.js";
import type { PdfBytes } from "../../api/types.js";
import type { PdfLibDocument } from "./document.js";
import { copyPagesInto, subsetToBytes } from "./util.js";

/**
 * `pdf-lib`-backed Assemble adapter — merge/split (brief 12).
 *
 * v1 keeps merge simple: pages (content + resources, size, rotation) are
 * copied via the shared `copyPagesInto` helper. AcroForm field-name
 * collisions across merged sources are not de-duplicated in v1 — if it
 * surfaces as a problem, it's a follow-up for the Forms capability (brief 13)
 * to reconcile.
 */
export class PdfLibAssemble implements Assemble {
  private readonly doc: PdfLibDocument;

  constructor(doc: PdfLibDocument) {
    this.doc = doc;
  }

  async merge(...sources: PdfBytes[]): Promise<void> {
    const dest = this.doc.pdfLibDocument;
    for (const source of sources) {
      // pdf-lib mutates its input view; copy so callers keep their buffer.
      const src = await PDFDocument.load(new Uint8Array(source));
      const indices = src.getPages().map((_, i) => i);
      await copyPagesInto(dest, src, indices);
    }
  }

  async split(spec: SplitSpec): Promise<PdfBytes[]> {
    const src = this.doc.pdfLibDocument;
    const pageCount = src.getPageCount();

    if ("ranges" in spec) {
      const out: PdfBytes[] = [];
      for (const [start, end] of spec.ranges) {
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 1 ||
          end < start ||
          end > pageCount
        ) {
          throw new PdfEngineError(
            `Assemble.split: invalid range [${start}, ${end}] for a document with ${pageCount} page(s).`,
          );
        }
        const indices: number[] = [];
        for (let p = start; p <= end; p++) indices.push(p - 1);
        out.push(await subsetToBytes(src, indices));
      }
      return out;
    }

    const { every } = spec;
    if (!Number.isInteger(every) || every < 1) {
      throw new PdfEngineError(
        `Assemble.split: "every" must be a positive integer, got ${every}.`,
      );
    }
    const out: PdfBytes[] = [];
    for (let start = 0; start < pageCount; start += every) {
      const end = Math.min(start + every, pageCount);
      const indices: number[] = [];
      for (let p = start; p < end; p++) indices.push(p);
      out.push(await subsetToBytes(src, indices));
    }
    return out;
  }
}
