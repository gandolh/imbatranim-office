/**
 * Exports run as one-off jobs in a worker, off the window's thread, from a
 * plain copy of the drawing. Where workers do not exist (tests), the same
 * code runs inline.
 */
import type { CadDocument, DocumentInit } from '../model/document'

export type ExportKind = 'svg' | 'pdf'

export type ExportRequest = { kind: ExportKind; title: string; drawing: DocumentInit }

/** What the worker is sent: everything the exporters read, as structured-clone data. */
export function exportRequest(doc: CadDocument, kind: ExportKind, title: string): ExportRequest {
  return {
    kind,
    title,
    drawing: {
      entities: doc.all(),
      layers: [...doc.layers.values()],
      linetypes: [...doc.linetypes.values()],
      blocks: [...doc.blocks.values()],
      currentLayer: doc.currentLayer,
      units: doc.units,
    },
  }
}

/** Run an export in a worker (or inline without one). */
export function exportInWorker(req: ExportRequest): Promise<Uint8Array> {
  // pdf-lib stays out of the app's own bundle: it loads only in the worker (or here, on demand).
  if (typeof Worker === 'undefined') return import('./run').then((m) => m.runExport(req))
  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (
      event: MessageEvent<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>
    ) => {
      worker.terminate()
      if (event.data.ok) resolve(event.data.bytes)
      else reject(new Error(event.data.error))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'the export worker failed'))
    }
    worker.postMessage(req)
  })
}
