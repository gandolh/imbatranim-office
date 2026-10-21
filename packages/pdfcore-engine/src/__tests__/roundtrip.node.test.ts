import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { loadPdf, NotImplemented } from "../index.node.js";
import type { RenderTarget } from "../index.node.js";

const MARKER = "PDFCORE_ROUNDTRIP_42";

/**
 * Build a 2-page fixture with extractable text using pdf-lib directly (the
 * engine's Generate capability is a brief-09 stub). Page 1 carries MARKER at a
 * known baseline; the document has a title in its Info dictionary.
 */
async function makeFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText(MARKER, { x: 72, y: 700, size: 18, font, color: rgb(0, 0, 0) });
  doc.addPage([612, 792]);
  doc.setTitle("Fixture Doc");
  return doc.save();
}

describe("@pdfcore/engine round-trip (Node)", () => {
  let fixture: Uint8Array;
  beforeAll(async () => {
    fixture = await makeFixture();
  });

  it("load → save → reload preserves page count", async () => {
    const doc = await loadPdf(fixture);
    expect(doc.pageCount()).toBe(2);

    const saved = await doc.save();
    expect(saved.byteLength).toBeGreaterThan(0);

    const reloaded = await loadPdf(saved);
    expect(reloaded.pageCount()).toBe(2);
  });

  it("exposes document metadata + page sizes", async () => {
    const doc = await loadPdf(fixture);
    expect(doc.metadata().title).toBe("Fixture Doc");
    expect(doc.pageSize(1)).toEqual({ width: 612, height: 792 });
    expect(doc.pageSizes()).toHaveLength(2);
  });

  it("renders page 1 to a canvas (pdf.js + @napi-rs/canvas)", async () => {
    const doc = await loadPdf(fixture);
    expect(await doc.render.pageCount()).toBe(2);

    const canvas = createCanvas(1, 1) as unknown as RenderTarget;
    const result = await doc.render.page(1, canvas, { scale: 1 });
    expect(result.width).toBe(612);
    expect(result.height).toBe(792);

    const vp = await doc.render.viewport(1, { scale: 2 });
    expect(vp.pageWidth).toBe(612);
    expect(vp.width).toBe(1224);
  });

  it("extracts positional text from the fixture", async () => {
    const doc = await loadPdf(fixture);
    const items = await doc.text.extract();
    const joined = items.map((i) => i.str).join("");
    expect(joined).toContain(MARKER);

    const hit = items.find((i) => i.str.includes(MARKER.slice(0, 6)));
    expect(hit).toBeDefined();
    expect(hit!.page).toBe(1);
    expect(hit!.x).toBeGreaterThan(60);
    expect(hit!.x).toBeLessThan(120);
    // Baseline 700 on a 792-pt page (bottom-left origin).
    expect(hit!.y).toBeGreaterThan(680);
    expect(hit!.y).toBeLessThan(720);

    expect(await doc.text.plain()).toContain(MARKER);
  });

  it("reads the outline tree without error (fixture has none)", async () => {
    const doc = await loadPdf(fixture);
    const tree = await doc.outline.tree();
    expect(Array.isArray(tree)).toBe(true);
    expect(tree).toHaveLength(0);
    expect(await doc.outline.destinations()).toEqual([]);
  });

  it("still-unimplemented capabilities fail fast with a named error", async () => {
    const doc = await loadPdf(fixture);

    // Pages(11), Assemble(12), Forms(13), Annotate(14), Sign(15) and
    // Text.search(16) are implemented as of wave 3 — see their own capability
    // test suites. Only the Generate primitive remains a stub here.
    expect(() => doc.generate.addPage()).toThrow(NotImplemented);
  });

  it("reports the platform binding", async () => {
    const doc = await loadPdf(fixture);
    expect(doc.platform).toBe("node");
  });
});
