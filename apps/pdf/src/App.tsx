import type { KitAppProps } from '@imbatranim-office/shared'
import { Pdf } from './Pdf'

/**
 * The module the desktop renders (OS brief 163): the built-ins' manifests
 * (`apps/add-ons/norpdf/src/index.ts`, id `norpdf`, and PDF Viewer's, id
 * `pdf-viewer`) become this component plus the suite descriptor's `office-pdf`
 * entry, which carries the name, icon, sizes, `opens` and capabilities the
 * manifests used to.
 *
 * The desktop renders this inside the window's `SystemProvider`, so the opened
 * file arrives through `useOpenIntent()` and the window's title, close guard
 * and focus through `useSystem()`. `host` is unused: PDF loads nothing by URL
 * of its own (its chunks and the pdf.js worker resolve beside this module) and
 * has no server.
 */
export function App({ windowId }: KitAppProps) {
  return <Pdf windowId={windowId} />
}
