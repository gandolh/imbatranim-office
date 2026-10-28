/**
 * The suite's server (brief 14). One job: DWG in, DXF out, for CAD.
 *
 * - `GET /health` answers at once. The desktop waits on it before any Office
 *   window opens (the server is the suite descriptor's, so every app's window
 *   leases it), so starting must stay cheap: LibreDWG loads per conversion,
 *   in a child process, never at start.
 * - `DWG_TO_DXF_PATH` is a WebSocket: the desktop proxies a service app's HTTP
 *   for GET and HEAD only, and its WebSockets both ways. The protocol is in
 *   `@imbatranim-office/shared/dwg`.
 */
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import {
  DWG_TO_DXF_PATH,
  MAX_DWG_BYTES,
  dwgVersion,
  type DwgFailure,
} from '@imbatranim-office/shared/dwg'
import { createConverter, type Converter } from './convert.ts'

export type ServerOptions = {
  convert?: Converter
  /** How long a socket may stay open without sending its file. */
  idleMs?: number
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const convert = options.convert ?? createConverter()
  const idleMs = options.idleMs ?? 30_000
  const app = Fastify({ logger: false })
  // One byte over the cap is enough to tell "too large" from "at the cap";
  // ws closes a socket whose message is larger with 1009.
  await app.register(websocket, { options: { maxPayload: MAX_DWG_BYTES + 1 } })

  app.get('/health', async () => ({ ok: true }))

  app.get(DWG_TO_DXF_PATH, { websocket: true }, (socket) => {
    const fail = (failure: DwgFailure) => {
      socket.send(JSON.stringify(failure))
      socket.close(1000)
    }
    const idle = setTimeout(() => socket.close(1000), idleMs)
    socket.once('message', (data, isBinary) => {
      clearTimeout(idle)
      if (!isBinary) return fail({ error: 'not-dwg' })
      const dwg = toBytes(data)
      if (dwg.byteLength > MAX_DWG_BYTES) return fail({ error: 'too-large' })
      const version = dwgVersion(dwg)
      if (!version) return fail({ error: 'not-dwg' })
      convert(dwg).then(
        (result) => {
          if (socket.readyState !== socket.OPEN) return
          if (!result.ok) return fail({ error: result.error, version })
          socket.send(result.dxf, { binary: true })
          socket.close(1000)
        },
        () => fail({ error: 'failed', version })
      )
    })
    socket.once('close', () => clearTimeout(idle))
  })

  return app
}

function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data)
}
