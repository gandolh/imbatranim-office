/**
 * One DWG → DXF conversion, in a child process of its own (see convert.ts).
 *
 * LibreDWG runs here as WebAssembly (`@mlightcad/libredwg-web`), never in the
 * browser: the desktop's CSP forbids wasm in the apps, and the image has no
 * compiler for LibreDWG's C. A fresh process per file keeps a wasm trap, a
 * hang or a gigabyte of wasm memory from outliving the one file that caused
 * it.
 *
 * Protocol (Node IPC, `serialization: 'advanced'`): the parent sends
 * `{ dwg: Uint8Array }`; this answers `{ ok: true, dxf }` (gzipped) or
 * `{ ok: false, detail }`, then exits.
 */
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export type ConverterRequest = { dwg: Uint8Array }
export type ConverterReply = { ok: true; dxf: Uint8Array } | { ok: false; detail: string }

type LibreDwgModule = {
  LibreDwg: {
    create(wasmDir: string): Promise<{ dwg_write_dxf(bytes: Uint8Array): Uint8Array | null }>
  }
}

async function convert(dwg: Uint8Array): Promise<ConverterReply> {
  const lib = (await import('@mlightcad/libredwg-web')) as unknown as LibreDwgModule
  // The package's exports name only its JS; its wasm sits in `wasm/` beside `dist/`.
  const wasmDir = fileURLToPath(new URL('../wasm', import.meta.resolve('@mlightcad/libredwg-web')))
  const libredwg = await lib.LibreDwg.create(wasmDir)
  const dxf = libredwg.dwg_write_dxf(dwg)
  if (!dxf) return { ok: false, detail: 'LibreDWG returned no DXF' }
  return { ok: true, dxf: gzipSync(dxf) }
}

process.once('message', (msg: ConverterRequest) => {
  convert(msg.dwg).then(
    (reply) => process.send!(reply, () => process.exit(0)),
    (err: unknown) =>
      process.send!({ ok: false, detail: String(err).slice(0, 300) } satisfies ConverterReply, () =>
        process.exit(0)
      )
  )
})
