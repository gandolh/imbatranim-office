/**
 * Public option/result/geometry types for `@pdfcore/engine`, in our own
 * vocabulary (DEC-1/DEC-37).
 *
 * IMPORTANT: nothing in this file (or anything it re-exports) may reference a
 * backend library type (pdf-lib / pdfjs-dist). These are the types that appear
 * in callers' code and in the generated public `.d.ts`.
 *
 * ── Coordinate convention (load-bearing, shared by every capability) ────────
 * All geometry the engine exposes is in **PDF user space**: origin BOTTOM-LEFT,
 * +x right, +y up, units = points (1/72 inch). This matches the `/Rect` entry
 * PDF annotations/widgets use and pdf-lib's draw origin, so annotations,
 * form widgets and search hits all agree without per-consumer flipping.
 *
 *   - {@link Point}   `{ x, y }`               a position in PDF user space.
 *   - {@link Rect}    `[x1, y1, x2, y2]`       lower-left (x1,y1) → upper-right
 *                                              (x2,y2), PDF user space. This is
 *                                              the canonical rect for Annotate
 *                                              specs, Forms widget geometry and
 *                                              Text search hits.
 *   - {@link Box}     `{ x, y, w, h }`         (x,y) = BOTTOM-LEFT corner. A
 *                                              convenience form the `coords`
 *                                              module converts to/from screen
 *                                              space; interchangeable with Rect
 *                                              via `boxToRect` / `rectToBox`.
 *
 * Screen space (top-left origin, +y down, CSS px) exists only inside `coords`
 * and the browser render/selection layer; it never appears on a public
 * capability signature.
 */

/** Raw PDF bytes as handed to/from the engine. */
export type PdfBytes = Uint8Array;

/** A point in PDF user space (origin bottom-left, units = points). */
export interface Point {
  x: number;
  y: number;
}

/**
 * A rectangle in PDF user space as `[x1, y1, x2, y2]` — lower-left corner
 * `(x1,y1)` to upper-right corner `(x2,y2)`. Canonical rect used by Annotate
 * specs, Forms field geometry and Text search hits (matches PDF `/Rect`).
 */
export type Rect = [x1: number, y1: number, x2: number, y2: number];

/**
 * A rectangle as an origin + size, `(x,y)` being the BOTTOM-LEFT corner in PDF
 * user space. Convenience form for the `coords` transforms; convert with
 * `boxToRect` / `rectToBox`.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A page size in PDF points. */
export interface PageSize {
  width: number;
  height: number;
}

/** RGB colour, components in 0–1. */
export interface Color {
  r: number;
  g: number;
  b: number;
}

/** Standard-14 font families available in v1 (DEC-13). No embedding yet. */
export type StandardFont =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-Italic"
  | "Courier"
  | "Courier-Bold";

/* ─────────────────────────────────────────────────────── Render ────────── */

/**
 * A render target. In the browser this is typically an `HTMLCanvasElement`;
 * in Node a `@napi-rs/canvas` canvas. We keep the type structural and
 * backend-agnostic so the public surface does not depend on DOM lib types.
 * Adapters validate the shape at runtime.
 */
export interface RenderTarget {
  /** A 2D drawing context, e.g. the result of `canvas.getContext("2d")`. */
  getContext(contextId: "2d"): unknown;
  width: number;
  height: number;
}

/** Options for {@link Render.page} / {@link Render.viewport}. */
export interface RenderOptions {
  /** Render scale; 1 = 100% at the PDF's native size. Default 1. */
  scale?: number;
  /** Clockwise rotation override in degrees (0 | 90 | 180 | 270). */
  rotation?: 0 | 90 | 180 | 270;
}

/** The pixel dimensions a page render produced (after scale + rotation). */
export interface RenderResult {
  width: number;
  height: number;
}

/**
 * The geometry of a page at a given scale/rotation — the bridge Render, the
 * selection text layer (brief 16) and annotation hit-testing (brief 14) all
 * align against. `width`/`height` are device pixels; `pageWidth`/`pageHeight`
 * are the intrinsic size in PDF points.
 */
export interface PageViewport {
  /** Device-pixel width after scale + rotation. */
  width: number;
  /** Device-pixel height after scale + rotation. */
  height: number;
  /** Intrinsic page width in PDF points (unrotated). */
  pageWidth: number;
  /** Intrinsic page height in PDF points (unrotated). */
  pageHeight: number;
  /** The scale applied. */
  scale: number;
  /** The effective rotation in degrees. */
  rotation: number;
}

/* ─────────────────────────────────────────────────────── Text ──────────── */

/**
 * A single positioned text fragment from extraction. Coordinates are PDF
 * points, bottom-left origin; `x`/`y` is the fragment's anchor and `w`/`h` its
 * measured box. Canonical shape consumed by the selection layer and search.
 */
export interface TextItem {
  /** 1-based page index the item was found on. */
  page: number;
  /** Anchor x in PDF points. */
  x: number;
  /** Anchor y in PDF points (baseline). */
  y: number;
  /** The text string of this fragment. */
  str: string;
  /** Measured width of the fragment in points. */
  w: number;
  /** Measured height (≈ font size) of the fragment in points. */
  h: number;
}

/** Options for {@link Text.extract} / {@link Text.plain}. */
export interface TextExtractOptions {
  /** Restrict extraction to these 1-based page indices. Default: all pages. */
  pages?: number[];
}

/** Options for {@link Text.search} (implemented by brief 16). */
export interface TextSearchOptions {
  /** Match case exactly. Default false. */
  caseSensitive?: boolean;
  /** Match whole words only. Default false. */
  wholeWord?: boolean;
  /** Fold diacritics so "café" matches "cafe". Default false. */
  ignoreDiacritics?: boolean;
  /** Restrict the search to these 1-based page indices. Default: all pages. */
  pages?: number[];
}

/**
 * One ordered search hit. `rects` are the highlight rectangles in PDF user
 * space (a hit spanning multiple text items yields multiple rects); `context`
 * is a short snippet of surrounding text for result lists.
 */
export interface TextHit {
  /** 1-based page index of the hit. */
  page: number;
  /** Highlight rectangles in PDF user space, reading order. */
  rects: Rect[];
  /** Surrounding text snippet for display. */
  context: string;
}

/* ─────────────────────────────────────────────────────── Outline ───────── */

/**
 * One node of the document outline (bookmarks). `dest` resolves to a 0-based
 * page index where known; `children` are nested bookmarks.
 */
export interface OutlineNode {
  /** Bookmark label. */
  title: string;
  /** Resolved 0-based destination page index, if the dest could be resolved. */
  pageIndex?: number;
  /** Raw named-destination string, when the bookmark points at one. */
  dest?: string;
  /** Nested bookmarks. */
  children: OutlineNode[];
}

/** A named destination → 0-based page index mapping. */
export interface NamedDestination {
  name: string;
  pageIndex?: number;
}

/* ─────────────────────────────────────────────────────── Document ──────── */

/** Document-level metadata (subset of the PDF Info dictionary). */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

/* ─────────────────────────────────────────────────────── Generate ──────── */

/** Options for creating a new document via {@link Generate.createDoc}. */
export interface CreateDocOptions {
  /** Initial page size in points. Defaults to US Letter (612 x 792). */
  pageSize?: PageSize;
  /** Number of blank pages to start with. Default 1. */
  pages?: number;
}

/** Options for {@link Generate.drawText}. Coordinates are PDF points, bottom-left origin. */
export interface DrawTextOptions {
  /** 1-based page index to draw on. Default 1. */
  page?: number;
  /** Baseline position in PDF points (origin bottom-left). */
  at: Point;
  /** Font size in points. Default 12. */
  size?: number;
  /** Standard-14 font. Default "Helvetica". */
  font?: StandardFont;
  /** Text colour as 0–1 RGB. Default black. */
  color?: Color;
}
