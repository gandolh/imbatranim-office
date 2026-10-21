import type { Generate } from "../../capabilities/Generate.js";
import { NotImplemented } from "../../api/errors.js";
import type {
  CreateDocOptions,
  DrawTextOptions,
  PageSize,
} from "../../api/types.js";
import type { PdfLibDocument } from "./document.js";

/**
 * `pdf-lib`-backed Generate adapter. STUB in brief 09 — the Studio-era working
 * implementation was intentionally dropped in the re-scaffold; document
 * creation is fleshed out when a consumer needs it. Throws {@link NotImplemented}.
 */
export class PdfLibGenerate implements Generate {
  constructor(_doc: PdfLibDocument) {}

  createDoc(_opts?: CreateDocOptions): void {
    throw new NotImplemented("Generate.createDoc", "not yet implemented");
  }
  addPage(_size?: PageSize): number {
    throw new NotImplemented("Generate.addPage", "not yet implemented");
  }
  drawText(_text: string, _opts: DrawTextOptions): void {
    throw new NotImplemented("Generate.drawText", "not yet implemented");
  }
}
