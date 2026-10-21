/** The export job: one drawing in, SVG or PDF bytes out. */
import type { ExportRequest } from './job'
import { runExport } from './run'

addEventListener('message', (event: MessageEvent<ExportRequest>) => {
  runExport(event.data).then(
    (bytes) => postMessage({ ok: true, bytes }, { transfer: [bytes.buffer] }),
    (err: unknown) =>
      postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  )
})
