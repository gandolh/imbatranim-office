/**
 * The pdf.js worker's entry file. pdf.js's worker module sets itself up on the
 * worker's port when it is evaluated, so importing it is all this file does.
 *
 * Started by {@link createPdfjsWorker} as `new Worker(new URL("./pdf.worker.ts",
 * import.meta.url))`, which bundlers (Vite, webpack 5, Rollup) emit as a file
 * of the consumer's own output. Browser only; never imported from Node.
 */
import "pdfjs-dist/build/pdf.worker.min.mjs";
