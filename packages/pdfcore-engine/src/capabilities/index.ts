/**
 * The ten capability interfaces (DEC-37), in our own vocabulary. Adapters in
 * `../adapters/*` implement these; the `PdfDoc` facade wires them together.
 */
export type { Document } from "./Document.js";
export type { Render } from "./Render.js";
export type { Text } from "./Text.js";
export type { Outline } from "./Outline.js";
export type { Annotate } from "./Annotate.js";
export type {
  AnnotationType,
  AnnotationBase,
  AnnotationSpec,
  Annotation,
  AnnotationPatch,
  MarkupAnnotationSpec,
  InkAnnotationSpec,
  RectAnnotationSpec,
  LineAnnotationSpec,
  FreeTextAnnotationSpec,
  NoteAnnotationSpec,
  StampAnnotationSpec,
} from "./Annotate.js";
export type { Forms, FieldInfo, FieldType, FieldValue } from "./Forms.js";
export type { Sign, SignatureMark, PlaceSignatureOptions } from "./Sign.js";
export type { Pages, PageInsert } from "./Pages.js";
export type { Assemble, SplitSpec } from "./Assemble.js";
export type { Generate } from "./Generate.js";
