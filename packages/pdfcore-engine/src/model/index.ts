/**
 * `model/` — the in-memory annotation/form edit model. CRUD mutates these
 * stores while a document is open; `PdfDoc.save()` commits them to real PDF
 * objects (DEC-39). Briefs 13 (Forms) and 14 (Annotate) populate the commit
 * wiring; the stores themselves are complete.
 */
export { AnnotationModel } from "./annotations.js";
export { FormModel } from "./forms.js";
