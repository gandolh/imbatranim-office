import type { KitAppProps } from '@imbatranim-office/shared'
import { Docs } from './Docs'

/**
 * The module the desktop renders (OS brief 163): the built-in's manifest
 * (`index.ts`, id `docs`) becomes this component plus the suite descriptor's
 * `office-docs` entry, which carries the name, icon, sizes, `opens` and
 * capabilities the manifest used to.
 *
 * Everything else the manifest's window handed Docs still reaches it the same
 * way: the desktop renders this inside the window's `SystemProvider`, so the
 * opened file arrives through `useOpenIntent()` and the window's title, close
 * guard and focus through `useSystem()`. `host` is unused: Docs loads nothing by
 * URL and has no server.
 */
export function App({ windowId }: KitAppProps) {
  return <Docs windowId={windowId} />
}
