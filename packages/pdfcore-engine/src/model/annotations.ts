import type {
  Annotation,
  AnnotationPatch,
  AnnotationSpec,
} from "../capabilities/Annotate.js";

/**
 * In-memory annotation edit model (DEC-39). While a document is open, Annotate
 * CRUD mutates this store; `PdfDoc.save()` commits it to real PDF annotation
 * objects. On load, existing annotations are read back in here (via
 * {@link seed}) so they are re-editable.
 *
 * Brief 09 provided the store shape + id management; **brief 14** adds the
 * bookkeeping the committer needs to avoid re-emitting objects that already
 * live in the PDF:
 *
 *  - `add(spec)` records a *new* annotation (not yet in the PDF).
 *  - `seed(annotation)` records an *existing* one read back on load — it is NOT
 *    re-emitted unless it is subsequently `update()`d.
 *  - `update`/`delete` on a seeded annotation flag it dirty / removed so the
 *    committer can rewrite or strip the underlying PDF object.
 *
 * After a commit the adapter calls {@link markCommitted}: every live annotation
 * becomes "seeded" (present in the PDF) and the pending sets are cleared, so a
 * second `save()` is a genuine no-op.
 */
export class AnnotationModel {
  readonly #byId = new Map<string, Annotation>();
  /** ids known to already exist as PDF objects (loaded or already committed). */
  readonly #seeded = new Set<string>();
  /** seeded ids modified since the last commit — their object must be rewritten. */
  readonly #dirty = new Set<string>();
  /** seeded ids deleted since the last commit — their object must be removed. */
  readonly #removed = new Set<string>();
  #seq = 0;

  /** Add a spec, assign an id, and return it. */
  add(spec: AnnotationSpec): string {
    const id = `anno_${++this.#seq}`;
    this.#byId.set(id, { ...spec, id } as Annotation);
    return id;
  }

  /**
   * Seed an annotation with a known id (used when reading existing ones back
   * on load). A seeded annotation is treated as already present in the PDF, so
   * the committer will not re-emit it.
   */
  seed(annotation: Annotation): void {
    this.#byId.set(annotation.id, annotation);
    this.#seeded.add(annotation.id);
  }

  /** Apply a partial patch to an existing annotation. */
  update(id: string, patch: AnnotationPatch): void {
    const existing = this.#byId.get(id);
    if (!existing) return;
    this.#byId.set(id, { ...existing, ...patch } as Annotation);
    if (this.#seeded.has(id)) this.#dirty.add(id);
  }

  /** Delete by id. */
  delete(id: string): void {
    if (!this.#byId.has(id)) return;
    this.#byId.delete(id);
    // A seeded annotation exists as a real PDF object that must be stripped on
    // commit; a never-committed one just vanishes from the model.
    if (this.#seeded.has(id)) {
      this.#removed.add(id);
      this.#dirty.delete(id);
    }
  }

  /** List all annotations, optionally filtered to a 1-based page. */
  list(page?: number): Annotation[] {
    const all = [...this.#byId.values()];
    return page === undefined ? all : all.filter((a) => a.page === page);
  }

  /** Number of annotations currently held. */
  get size(): number {
    return this.#byId.size;
  }

  /** True if `id` corresponds to an annotation already present in the PDF. */
  isSeeded(id: string): boolean {
    return this.#seeded.has(id);
  }

  /**
   * Annotations the committer must (re)emit as PDF objects: everything that is
   * either brand new or a seeded annotation that was edited.
   */
  toWrite(): Annotation[] {
    return [...this.#byId.values()].filter(
      (a) => !this.#seeded.has(a.id) || this.#dirty.has(a.id),
    );
  }

  /**
   * Seeded ids whose underlying PDF object must be removed before serialising:
   * ones that were deleted, plus edited ones (their stale object is stripped
   * and a fresh one is written by {@link toWrite}).
   */
  toRemove(): string[] {
    return [...this.#removed, ...this.#dirty];
  }

  /**
   * Called by the adapter after a successful commit. Every live annotation is
   * now backed by a PDF object, so mark them all seeded and clear the pending
   * change sets (a subsequent `save()` with no further edits is a no-op).
   */
  markCommitted(): void {
    for (const id of this.#byId.keys()) this.#seeded.add(id);
    this.#dirty.clear();
    this.#removed.clear();
  }
}
