import { useEffect, useState } from 'react'
import {
  Button,
  ConfirmDialog,
  describeFileFailure,
  fileName,
  useOpenIntent,
  useSystem,
} from '@imbatranim/ui'
import type { KitAppProps } from '@imbatranim-office/shared'

type Outcome =
  | { state: 'read'; size: number; lines: number | null }
  | { state: 'failed'; message: string }

/** Count lines off the main thread, in the worker the build emits as its own file. */
function countLinesInWorker(bytes: ArrayBuffer): { lines: Promise<number>; stop: () => void } {
  const worker = new Worker(new URL('./lines.worker.ts', import.meta.url), { type: 'module' })
  const lines = new Promise<number>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<number>) => resolve(event.data)
    worker.onerror = (event) => reject(new Error(event.message || 'the worker failed'))
  })
  worker.postMessage(bytes, [bytes])
  return { lines, stop: () => worker.terminate() }
}

function bytesText(size: number): string {
  return size === 1 ? '1 byte' : `${size.toLocaleString('en-US')} bytes`
}

/**
 * The smoke app (brief 01, deleted by brief 02): proves a kit app opens in a
 * desktop window with the desktop's own React and kit. It reads the file the
 * window was opened with and shows its size, and opens the kit's
 * ConfirmDialog from a kit Button.
 */
export function App({ windowId, host }: KitAppProps) {
  const system = useSystem()
  const file = useOpenIntent()
  const fileKey = file ? `${file.root}:${file.path}` : null
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(0)

  useEffect(() => {
    if (!file) return
    const key = `${file.root}:${file.path}`
    let cancelled = false
    let stopWorker: (() => void) | null = null
    system.fs.readWithVersion(file.root, file.path).then(
      ({ bytes }) => {
        if (cancelled) return
        const size = bytes.byteLength
        setResult({ key, outcome: { state: 'read', size, lines: null } })
        const job = countLinesInWorker(bytes.slice(0))
        stopWorker = job.stop
        job.lines
          .then(
            (lines) => {
              if (!cancelled) setResult({ key, outcome: { state: 'read', size, lines } })
            },
            () => undefined
          )
          .finally(job.stop)
      },
      (err: unknown) => {
        if (!cancelled) {
          setResult({
            key,
            outcome: { state: 'failed', message: describeFileFailure('open', err, 'file') },
          })
        }
      }
    )
    return () => {
      cancelled = true
      stopWorker?.()
    }
  }, [system, file])

  const outcome = result && result.key === fileKey ? result.outcome : null

  return (
    <div className="font-ui bg-surface text-on-surface flex h-full flex-col gap-3 p-3 text-[13px]">
      <h1 className="text-[15px] font-semibold">Office smoke test</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-on-surface-variant">File</dt>
        <dd>{file ? fileName(file.path) : 'None. Open a file with this app from File Manager.'}</dd>
        <dt className="text-on-surface-variant">Size</dt>
        <dd>
          {!file
            ? '-'
            : outcome === null
              ? 'Reading…'
              : outcome.state === 'failed'
                ? outcome.message
                : bytesText(outcome.size)}
        </dd>
        <dt className="text-on-surface-variant">Lines</dt>
        <dd>
          {outcome?.state === 'read'
            ? outcome.lines === null
              ? 'Counting…'
              : `${outcome.lines.toLocaleString('en-US')} ${outcome.lines === 1 ? 'line' : 'lines'} (counted in a worker)`
            : '-'}
        </dd>
        <dt className="text-on-surface-variant">Window</dt>
        <dd>{windowId}</dd>
        <dt className="text-on-surface-variant">App</dt>
        <dd>{host.appId}</dd>
      </dl>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => setDialogOpen(true)}>
          Open a dialog
        </Button>
        {confirmed > 0 && (
          <span className="text-on-surface-variant">
            Confirmed {confirmed === 1 ? 'once' : `${confirmed} times`}.
          </span>
        )}
      </div>
      <ConfirmDialog
        open={dialogOpen}
        title="Smoke test"
        message="This is the desktop's own ConfirmDialog, lent to the app through the shared kit."
        onConfirm={() => {
          setDialogOpen(false)
          setConfirmed((n) => n + 1)
        }}
        onCancel={() => setDialogOpen(false)}
      />
    </div>
  )
}
