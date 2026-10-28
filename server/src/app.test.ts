import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { DWG_TO_DXF_PATH, MAX_DWG_BYTES } from '@imbatranim-office/shared/dwg'
import { buildServer } from './app.ts'
import type { Converter } from './convert.ts'

const servers: FastifyInstance[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
})

async function start(convert: Converter, idleMs?: number): Promise<string> {
  const app = await buildServer({ convert, idleMs })
  servers.push(app)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address() as { port: number }
  return `ws://127.0.0.1:${port}${DWG_TO_DXF_PATH}`
}

type Answer = { text?: string; binary?: Uint8Array; code: number }

/** Send one message, collect the answer and the close code, as CAD does. */
function exchange(url: string, message?: Uint8Array<ArrayBuffer> | string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const answer: Omit<Answer, 'code'> = {}
    ws.onopen = () => {
      if (message !== undefined) ws.send(message)
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') answer.text = e.data
      else answer.binary = new Uint8Array(e.data as ArrayBuffer)
    }
    ws.onclose = (e) => resolve({ ...answer, code: e.code })
    ws.onerror = () => undefined
    setTimeout(() => reject(new Error('no close')), 10_000)
  })
}

const dwg = (rest = '') => new TextEncoder().encode(`AC1032${rest}`)
const echo: Converter = async (bytes) => ({ ok: true, dxf: bytes })

describe('the suite server', () => {
  it('answers its health check without loading LibreDWG', async () => {
    let converted = 0
    const app = await buildServer({
      convert: async () => (converted++, { ok: false, error: 'failed' }),
    })
    servers.push(app)
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(converted).toBe(0)
  })

  it('takes a DWG as one binary message and answers the DXF as one, then closes', async () => {
    const url = await start(echo)
    const answer = await exchange(url, dwg(' drawing'))
    expect(new TextDecoder().decode(answer.binary)).toBe('AC1032 drawing')
    expect(answer.text).toBeUndefined()
    expect(answer.code).toBe(1000)
  })

  it('refuses what is not a DWG before converting', async () => {
    let converted = 0
    const url = await start(async (b) => (converted++, { ok: true, dxf: b }))
    expect(JSON.parse((await exchange(url, new TextEncoder().encode('PK zip'))).text!)).toEqual({
      error: 'not-dwg',
    })
    expect(JSON.parse((await exchange(url, 'AC1032 as text')).text!)).toEqual({ error: 'not-dwg' })
    expect(converted).toBe(0)
  })

  it('passes a failed conversion on with the file’s version', async () => {
    const url = await start(async () => ({ ok: false, error: 'timeout' }))
    const answer = await exchange(url, dwg())
    expect(JSON.parse(answer.text!)).toEqual({ error: 'timeout', version: 'AC1032' })
    expect(answer.code).toBe(1000)
  })

  it('refuses a file over the cap without converting it', async () => {
    let converted = 0
    const url = await start(async (b) => (converted++, { ok: true, dxf: b }))
    const over = (n: number) => {
      const big = new Uint8Array(MAX_DWG_BYTES + n)
      big.set(dwg())
      return big
    }
    // One byte over: the route says so.
    expect(JSON.parse((await exchange(url, over(1))).text!)).toEqual({ error: 'too-large' })
    // More: ws closes the socket (1009) before the message is buffered whole.
    expect((await exchange(url, over(2))).code).toBe(1009)
    expect(converted).toBe(0)
  })

  it('closes a socket that never sends its file', async () => {
    const url = await start(echo, 200)
    const answer = await exchange(url)
    expect(answer).toEqual({ code: 1000 })
  })
})
