/**
 * How CAD and the suite's server talk about DWG (brief 14). Shared so the two
 * sides cannot drift: the server imports it from Node, CAD from the browser,
 * so it holds plain values only.
 *
 * The exchange runs over a WebSocket, because the desktop proxies a service
 * app's HTTP for GET and HEAD only and its WebSockets both ways (imbatranimOS
 * `marketplace.controller.ts` and `marketplace-ws.proxy.ts`). CAD opens
 * {@link DWG_TO_DXF_PATH} on `host.server.ws` and sends the DWG as one binary
 * message. The server answers one binary message, the DXF gzipped, or one
 * text message, a {@link DwgFailure} as JSON, and closes.
 */

/** The server's route, under `host.server.ws`. */
export const DWG_TO_DXF_PATH = '/dwg-to-dxf'

/** The largest DWG the server takes. */
export const MAX_DWG_BYTES = 50 * 1024 * 1024

/** How long one conversion may run before the server stops it. */
export const CONVERT_TIMEOUT_MS = 60_000

/**
 * Why a conversion did not happen:
 * - `too-large`: over {@link MAX_DWG_BYTES}
 * - `not-dwg`: the bytes do not start like a DWG
 * - `unreadable`: LibreDWG could not read it (a version or object it does not handle)
 * - `timeout`: over {@link CONVERT_TIMEOUT_MS}
 * - `busy`: other conversions are waiting already
 * - `failed`: anything else on the server's side
 */
export type DwgFailureKind = 'too-large' | 'not-dwg' | 'unreadable' | 'timeout' | 'busy' | 'failed'

/** The server's text answer when there is no DXF. `version` is the file's code, `AC1032`. */
export type DwgFailure = { error: DwgFailureKind; version?: string }

const RELEASES: Record<string, string> = {
  'AC1.2': 'R1.2',
  'AC1.40': 'R1.4',
  'AC1.50': 'R2.0',
  'AC2.10': 'R2.10',
  AC1001: 'R2.5',
  AC1002: 'R2.6',
  AC1003: 'R9',
  AC1004: 'R10',
  AC1006: 'R11',
  AC1009: 'R12',
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018',
}

/** The version code a DWG starts with (`AC1032`), or null when it does not start like one. */
export function dwgVersion(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes.subarray(0, 6))
  if (!/^AC\d/.test(head)) return null
  return head.replace(/[^A-Z0-9.]+$/, '')
}

/** "AutoCAD 2018" for `AC1032`; the code itself when it is not one we know. */
export function dwgRelease(version: string): string {
  return RELEASES[version] ?? version
}
