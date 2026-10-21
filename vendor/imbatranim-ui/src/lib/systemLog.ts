/**
 * The shape of a system-log entry (brief 84).
 *
 * This lives in the SDK rather than in the Logs add-on because it is a
 * **backend contract**, not that app's private model. The add-on imports it
 * from here; the presentation (event labels, relative times, row summaries)
 * stays in the add-on, where it belongs. Sign-in history used to be derived
 * here too; nothing has logged sign-in since 2026-09-06.
 */
export type LogLevel = 'info' | 'warn' | 'error'
export type LogSource = 'server' | 'client'

export interface LogEntry {
  /** ISO timestamp. */
  t: string
  level: LogLevel
  /** Stable dotted event name, e.g. `backup.restored`. */
  event: string
  /**
   * `client` means the browser reported it, so it is only as trustworthy as the
   * session that sent it. Never render the two the same way.
   */
  source: LogSource
  msg: string
  meta?: unknown
}
