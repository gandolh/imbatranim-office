/** The export itself, shared by the worker and the inline fallback. */
import { CadDocument } from '../model/document'
import type { ExportRequest } from './job'
import { exportPdf } from './pdf'
import { exportSvg } from './svg'

export async function runExport(req: ExportRequest): Promise<Uint8Array> {
  const doc = new CadDocument(req.drawing)
  return req.kind === 'svg' ? exportSvg(doc) : exportPdf(doc, req.title)
}
