import type {
  Sign,
  PlaceSignatureOptions,
  SignatureMark,
} from "../../capabilities/Sign.js";
import { PdfEngineError } from "../../api/errors.js";
import type { Annotate } from "../../capabilities/Annotate.js";
import type { Forms } from "../../capabilities/Forms.js";
import type { Point, Rect } from "../../api/types.js";

/**
 * Sign adapter (brief 15). Places a **visual** signature/initials mark and fills
 * AcroForm signature fields. This is NOT cryptographic PKI signing (parked,
 * post-v1) — it stamps a picture (raster) or draws strokes (vector) at a rect.
 *
 * It is deliberately thin: it composes the {@link Annotate} and {@link Forms}
 * capabilities rather than touching pdf-lib. Image embedding and annotation
 * dictionary/appearance authoring belong to brief 14's native writer, reached
 * through `annotate.add`. Persistence is free: `annotate.add` stages into the
 * shared annotation model and `PdfDoc.save()` commits it, so a placed mark
 * survives save → reload as a real annotation object.
 *
 * Coordinate mapping: a `SignatureMark` of `kind: "vector"` carries paths in
 * some capture space; both {@link place} and {@link fillSignatureField} map the
 * paths' bounding box onto the target rect (fill, matching how the stamp path
 * scales an image to fill its rect — aspect ratio is not preserved, so callers
 * should pass a rect whose proportions match the capture).
 *
 * v1 limitation: a filled signature field is rendered by placing a stamp/ink
 * annotation over the field's widget rect. We do NOT rewrite the signature
 * widget's own `/AP` (and cannot flatten through Forms — `Forms.set` rejects
 * signature fields by design), and we do NOT produce a `/Sig` value or a
 * cryptographic signature. The mark is a visible overlay only.
 */
export class SignAdapter implements Sign {
  private readonly annotate: Annotate;
  private readonly forms: Forms;

  constructor(annotate: Annotate, forms: Forms) {
    this.annotate = annotate;
    this.forms = forms;
  }

  place(opts: PlaceSignatureOptions): void {
    this.#placeMark(opts.page, opts.rect, opts.mark);
  }

  fillSignatureField(name: string, mark: SignatureMark): void {
    const field = this.forms.get(name);
    if (!field) {
      throw new PdfEngineError(
        `Sign.fillSignatureField: no field named "${name}".`,
      );
    }
    if (field.type !== "signature") {
      throw new PdfEngineError(
        `Sign.fillSignatureField: field "${name}" is a ${field.type} field, not a signature field.`,
      );
    }
    // Fill by placing the mark over the widget's rect on its page — same path as
    // place(). We cannot write the signature widget's own appearance via Forms
    // (Forms.set throws for signature fields), so a placed annotation is the v1
    // fill mechanism.
    this.#placeMark(field.page, field.rect, mark);
  }

  /* ─────────────────────────────── internals ──────────────────────────── */

  /** Route a mark to the correct Annotate primitive at the given rect/page. */
  #placeMark(page: number, rect: Rect, mark: SignatureMark): void {
    if (mark.kind === "image") {
      // Raster: a stamp annotation. The native writer auto-detects PNG/JPEG,
      // embeds it, and scales it to fill the rect.
      this.annotate.add({
        type: "stamp",
        page,
        rect,
        image: mark.image,
        name: "Signature",
      });
      return;
    }
    // Vector: freehand ink. Map the capture-space strokes into the target rect.
    this.annotate.add({
      type: "ink",
      page,
      paths: fitPathsToRect(mark.paths, rect),
      ...(mark.width !== undefined ? { width: mark.width } : {}),
    });
  }
}

/* ────────────────────────────── module helpers ────────────────────────── */

/**
 * Map every point of `paths` from their shared bounding box onto `rect` (fill).
 * Empty input returns `[]`; a zero-extent axis collapses to the rect's midpoint
 * on that axis (avoids divide-by-zero for a single point or a straight line).
 */
function fitPathsToRect(paths: Point[][], rect: Rect): Point[][] {
  const [x1, y1, x2, y2] = rect;
  const rx = Math.min(x1, x2);
  const ry = Math.min(y1, y2);
  const rw = Math.abs(x2 - x1);
  const rh = Math.abs(y2 - y1);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of paths) {
    for (const p of stroke) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return []; // no points at all

  const bw = maxX - minX;
  const bh = maxY - minY;
  const mapX = (x: number): number =>
    bw > 0 ? rx + ((x - minX) / bw) * rw : rx + rw / 2;
  const mapY = (y: number): number =>
    bh > 0 ? ry + ((y - minY) / bh) * rh : ry + rh / 2;

  return paths.map((stroke) =>
    stroke.map((p) => ({ x: mapX(p.x), y: mapY(p.y) })),
  );
}
