/**
 * `native/` — our own backend implementations, grown piece by piece as we
 * replace `pdf-lib`/`pdfjs-dist` behind the capability interfaces (DEC-2). The
 * first inhabitant is the annotation-dictionary writer (brief 14).
 */
export { NativeAnnotationWriter } from "./annotate.js";
