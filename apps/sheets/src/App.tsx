import type { KitAppProps } from '@imbatranim-office/shared'
import { Sheets } from './Sheets'

/**
 * The module the desktop renders (OS brief 163): the built-in's manifest
 * (`index.ts`, id `sheets`) becomes this component plus the suite descriptor's
 * `office-sheets` entry, which carries the name, icon, sizes, `opens` and
 * capabilities the manifest used to.
 *
 * The opened file arrives through `useOpenIntent()` and the window's title,
 * close guard and focus through `useSystem()`, as they did for the built-in.
 * `host` is unused: Sheets loads nothing by URL (its worker is a file beside
 * this module) and has no server.
 */
export function App({ windowId }: KitAppProps) {
  return <Sheets windowId={windowId} />
}
