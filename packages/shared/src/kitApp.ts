import type { ComponentType } from 'react'

/**
 * Where things are, for the app: the `host` prop. The same object the OS's
 * `mount(container, system, host)` receives (imbatranimOS
 * `apps/core/src/modules/marketplace/scopeHandle.ts`, `NativeHostContext`).
 * Mirrored here because the kit does not export it and nothing in this repo
 * may import `@imbatranim/core`; keep the two in step on a kit:sync.
 */
export type NativeHostContext = {
  appId: string
  /** The URL of the directory the app's module was served from, ending in `/`. */
  assetBase: string
  /** The suite's server, through the desktop's session-checked proxy. Null for a static suite. */
  server: { http: string; ws: string } | null
}

/** The props the desktop renders an app's `App` with (OS brief 163, contract C). */
export type KitAppProps = { windowId: string; host: NativeHostContext }

/** What `apps/<name>/src/App.tsx` exports as `App`. */
export type KitApp = ComponentType<KitAppProps>
