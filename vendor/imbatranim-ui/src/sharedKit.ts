/**
 * The shared kit (brief 163): what a marketplace **kit app** links against at
 * runtime instead of bundling. The desktop puts its own instances of React,
 * React DOM and this package on `globalThis.__imbatranimShared` before the
 * first kit app loads; the app's build marks {@link SHARED_KIT_MODULES}
 * external and reads each import from there, so `useSystem()`, the dialogs
 * and the theme it renders are the desktop's own.
 *
 * Not a protocol change: `PROTOCOL_VERSION` (`./system`) versions the handle,
 * this versions the modules.
 */

/**
 * The version of the shared modules' contract. Goes up when one of them
 * changes incompatibly: a React major, a kit export removed, or a kit
 * component's props changed in a breaking way. Adding an export or a module
 * is not a bump. A kit app's descriptor names the version its build was made
 * against (`sharedKit`), and the desktop refuses to render it when this
 * differs.
 *
 * Declared inline on purpose: an outside repo's snapshot of this directory
 * reads the value from this line.
 */
export const SHARED_KIT_VERSION = 1

/** The specifiers the desktop shares, the keys of `__imbatranimShared.modules`. */
export const SHARED_KIT_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@imbatranim/ui',
] as const

export type SharedKitModule = (typeof SHARED_KIT_MODULES)[number]

/**
 * Where things are, for a marketplace app: the third argument to a module's
 * `mount`, and a kit app's `host` prop.
 */
export type NativeHostContext = {
  appId: string
  /** The URL of the directory the app's module was served from, ending in `/`. */
  assetBase: string
  /** A service app's server, through the desktop's session-checked proxy. Null for a static app. */
  server: { http: string; ws: string } | null
}

/** The props the desktop renders a kit app's `App` export with. */
export type KitAppProps = { windowId: string; host: NativeHostContext }
