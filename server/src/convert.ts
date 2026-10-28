/**
 * DWG → DXF, one file at a time, each in a child process (converter.ts).
 *
 * A child per file rather than one long-lived wasm instance: LibreDWG's wasm
 * build can trap on a file it misreads (its own object conversion does on an
 * R2000 sample), and a trapped instance is not safe to reuse. It also takes
 * 260–320 MB per file (the build reserves 1 GB of wasm memory), which a
 * process gives back when it exits. The time limit kills the child.
 */
import { fork } from 'node:child_process'
import { CONVERT_TIMEOUT_MS, type DwgFailureKind } from '@imbatranim-office/shared/dwg'
import type { ConverterReply, ConverterRequest } from './converter.ts'

export type ConvertResult = { ok: true; dxf: Uint8Array } | { ok: false; error: DwgFailureKind }

export type Converter = (dwg: Uint8Array) => Promise<ConvertResult>

export type ConverterOptions = {
  /** Kill a conversion after this long. */
  timeoutMs?: number
  /** Conversions that may wait behind the running one before more are refused as busy. */
  maxWaiting?: number
  /** The child's entry; tests point it at a stand-in. */
  entry?: URL
  /** Where a failure's detail goes (the server's log). */
  log?: (line: string) => void
}

/** Run one conversion in a fresh child process. */
function runChild(
  dwg: Uint8Array,
  entry: URL,
  timeoutMs: number,
  log: (line: string) => void
): Promise<ConvertResult> {
  return new Promise((resolve) => {
    const child = fork(entry, [], { serialization: 'advanced', stdio: 'inherit' })
    let settled = false
    const finish = (result: ConvertResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      resolve(result)
    }
    const timer = setTimeout(() => {
      log(`conversion stopped after ${timeoutMs} ms`)
      finish({ ok: false, error: 'timeout' })
    }, timeoutMs)
    child.once('message', (reply: ConverterReply) => {
      if (reply.ok) return finish({ ok: true, dxf: reply.dxf })
      log(`conversion failed: ${reply.detail}`)
      finish({ ok: false, error: 'unreadable' })
    })
    child.once('error', (err) => {
      log(`converter did not start: ${String(err)}`)
      finish({ ok: false, error: 'failed' })
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      log(`converter exited (${signal ?? code}) without an answer`)
      finish({ ok: false, error: 'unreadable' })
    })
    child.send({ dwg } satisfies ConverterRequest)
  })
}

/** A converter that runs one child at a time and queues a few behind it. */
export function createConverter(options: ConverterOptions = {}): Converter {
  const timeoutMs = options.timeoutMs ?? CONVERT_TIMEOUT_MS
  const maxWaiting = options.maxWaiting ?? 3
  const entry = options.entry ?? new URL('./converter.ts', import.meta.url)
  const log = options.log ?? ((line) => console.error(line))
  let tail: Promise<unknown> = Promise.resolve()
  let waiting = 0

  return (dwg) => {
    if (waiting >= maxWaiting) return Promise.resolve({ ok: false, error: 'busy' })
    waiting++
    const run = tail.then(() => {
      waiting--
      return runChild(dwg, entry, timeoutMs, log)
    })
    tail = run.catch(() => undefined)
    return run
  }
}
