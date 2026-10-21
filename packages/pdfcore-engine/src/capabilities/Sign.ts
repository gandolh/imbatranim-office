import type { PdfBytes, Point, Rect } from "../api/types.js";

/**
 * A signature/initials mark to place: either raster image bytes (drawn, typed,
 * or uploaded PNG/JPEG) or a vector path in PDF user-space points.
 */
export type SignatureMark =
  | { kind: "image"; image: PdfBytes }
  | { kind: "vector"; paths: Point[][]; width?: number };

/** Options for {@link Sign.place}. */
export interface PlaceSignatureOptions {
  /** 1-based page index. */
  page: number;
  /** Target rectangle in PDF user space. */
  rect: Rect;
  /** The mark to render. */
  mark: SignatureMark;
}

/**
 * Sign — place a **visual** signature/initials mark as a stamp annotation, or
 * fill an AcroForm signature field's appearance. This is not cryptographic PKI
 * signing (parked, post-v1). Built on Annotate (stamp) + Forms (signature
 * field).
 *
 * Platform: **common**. Implemented by **brief 15** (depends on 13 + 14).
 */
export interface Sign {
  /** Place a signature mark as a stamp annotation at a rect on a page. */
  place(opts: PlaceSignatureOptions): void;

  /**
   * Fill an AcroForm signature field, setting its visual appearance to `mark`.
   * @param name signature field name.
   */
  fillSignatureField(name: string, mark: SignatureMark): void;
}
