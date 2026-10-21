/**
 * The smoke app's worker. It exists to prove the build emits a worker as a
 * file the desktop serves beside the app (the CSP allows workers from 'self'
 * only), which Sheets and PDF depend on. It counts the lines of the file.
 */
import { countLines } from './lines'

addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
  postMessage(countLines(new Uint8Array(event.data)))
})
