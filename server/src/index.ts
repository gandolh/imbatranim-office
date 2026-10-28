/**
 * Start the suite's server. The desktop runs `node server/src/index.ts` from
 * the build's root (Node strips the types; the image has no compiler and this
 * repo commits no build output), with the port in `PORT` and `HOST` set to
 * 127.0.0.1. See app.ts for what it serves.
 */
import { buildServer } from './app.ts'

const port = Number(process.env.PORT ?? 41999)
const host = process.env.HOST ?? '127.0.0.1'

const app = await buildServer()
await app.listen({ port, host })
console.log(`imbatranim-office server on ${host}:${port}`)

const stop = () => void app.close().then(() => process.exit(0))
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
