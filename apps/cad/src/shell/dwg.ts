/**
 * Opening a DWG (brief 14): CAD cannot read DWG itself (no reader exists
 * without WebAssembly, which the desktop's CSP forbids in the apps), so the
 * suite's server converts it to DXF with LibreDWG and CAD reads the DXF.
 * The exchange is in `@imbatranim-office/shared/dwg`.
 *
 * Every way it can fail ends in a {@link DwgOpenError} whose sentence goes in
 * CAD's window: never a blank canvas.
 */
import {
  CONVERT_TIMEOUT_MS,
  DWG_TO_DXF_PATH,
  MAX_DWG_BYTES,
  dwgRelease,
  type DwgFailure,
  type DwgFailureKind,
} from '@imbatranim-office/shared/dwg'

/** The server's kinds, plus the two only the window can see. */
export type DwgOpenFailure = DwgFailureKind | 'no-server' | 'unreachable'

export class DwgOpenError extends Error {
  readonly kind: DwgOpenFailure
  /** The DWG's size in bytes. */
  readonly size: number
  /** Its version code (`AC1032`), when the server read that far. */
  readonly version: string | undefined
  constructor(kind: DwgOpenFailure, size: number, version?: string) {
    super(`DWG conversion failed: ${kind}`)
    this.kind = kind
    this.size = size
    this.version = version
  }
}

export const isDwgPath = (path: string) => /\.dwg$/i.test(path)

/** The DXF a DWG drawing is saved as: same folder, same name. */
export const dxfBeside = (path: string) => path.replace(/\.dwg$/i, '.dxf')

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

/** The sentence CAD shows for a failed DWG open. */
export function dwgFailureSentence(err: DwgOpenError, name: string): string {
  switch (err.kind) {
    case 'no-server':
    case 'unreachable':
      return `The Office server is not answering, so ${name} could not be converted. DXF drawings still open.`
    case 'too-large':
      return `${name} is ${mb(err.size)}; CAD converts DWG drawings up to ${mb(MAX_DWG_BYTES)}.`
    case 'not-dwg':
      return `${name} is not a DWG drawing.`
    case 'unreadable':
      return err.version
        ? `LibreDWG could not read ${name} (${dwgRelease(err.version)} format).`
        : `LibreDWG could not read ${name}.`
    case 'timeout':
      return `Converting ${name} took longer than ${CONVERT_TIMEOUT_MS / 1000} s and was stopped.`
    case 'busy':
      return `The Office server is converting other drawings. Try ${name} again in a moment.`
    case 'failed':
      return `The Office server could not convert ${name}.`
  }
}

async function gunzip(gz: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Response(gz).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Send a DWG to the suite's server and resolve its DXF. `serverWs` is the
 * window's `host.server.ws` (null for a static install: no server).
 */
export function convertDwg(serverWs: string | null, dwg: ArrayBuffer): Promise<Uint8Array> {
  const size = dwg.byteLength
  if (!serverWs) return Promise.reject(new DwgOpenError('no-server', size))
  if (size > MAX_DWG_BYTES) return Promise.reject(new DwgOpenError('too-large', size))
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(serverWs.replace(/\/$/, '') + DWG_TO_DXF_PATH)
    ws.binaryType = 'arraybuffer'
    let dxf: ArrayBuffer | null = null
    let failure: DwgFailure | null = null
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn()
    }
    // The server stops a conversion at CONVERT_TIMEOUT_MS; this covers the upload around it.
    const timer = setTimeout(() => {
      ws.close()
      finish(() => reject(new DwgOpenError('timeout', size)))
    }, CONVERT_TIMEOUT_MS + 30_000)
    ws.onopen = () => ws.send(dwg)
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') {
        dxf = e.data as ArrayBuffer
        return
      }
      try {
        failure = JSON.parse(e.data) as DwgFailure
      } catch {
        failure = { error: 'failed' }
      }
    }
    ws.onclose = (e: CloseEvent) => {
      const gz = dxf
      if (gz) {
        return finish(() =>
          gunzip(gz).then(resolve, () => reject(new DwgOpenError('failed', size)))
        )
      }
      if (failure) {
        const { error, version } = failure
        return finish(() => reject(new DwgOpenError(error ?? 'failed', size, version)))
      }
      // 1009: the message was over the server's limit.
      finish(() => reject(new DwgOpenError(e.code === 1009 ? 'too-large' : 'unreachable', size)))
    }
  })
}
