/**
 * A stand-in for converter.ts in tests: what it does depends on the first
 * byte of the "DWG". `h` hangs, `x` exits without answering, `e` answers a
 * failure, anything else answers its input as the "DXF".
 */
import type { ConverterReply, ConverterRequest } from '../converter.ts'

process.once('message', ({ dwg }: ConverterRequest) => {
  const first = String.fromCharCode(dwg[0])
  if (first === 'h') return setInterval(() => undefined, 1000)
  if (first === 'x') process.exit(3)
  const reply: ConverterReply =
    first === 'e' ? { ok: false, detail: 'stand-in failure' } : { ok: true, dxf: dwg }
  process.send!(reply, () => process.exit(0))
})
