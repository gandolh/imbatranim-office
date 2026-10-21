/**
 * The engine, loaded on demand: `PdfDoc` (pdf-lib for writes, pdf.js for
 * reads) and the browser text layer. About half a megabyte of code the first
 * page does not need, so it is a dynamic import that starts after the first
 * page is on screen (see useReaderController) and is shared by every window.
 */
export type Engine = typeof import('./engineModule')

let loading: Promise<Engine> | null = null

export function loadEngine(): Promise<Engine> {
  if (!loading) {
    const attempt = import('./engineModule')
    loading = attempt
    // A failed chunk load may work next time (the suite was updated under it).
    attempt.catch(() => {
      if (loading === attempt) loading = null
    })
  }
  return loading
}
