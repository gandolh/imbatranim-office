import {
  FileConflictError,
  type SystemEvent,
  type SystemEventMap,
  type SystemHandle,
} from '@imbatranim/ui'
import type { NativeHostContext } from '../kitApp'

/**
 * A complete, in-memory `SystemHandle` for unit tests: what the desktop's
 * scoped handle does, minus the desktop. Files live in a map keyed by
 * `root:path`; intents, notifications, titles and recents are recorded so a
 * test can assert on them.
 */
export type FakeSystemOptions = {
  appId?: string
  /** Null makes a windowless handle (a service or widget). */
  windowId?: string | null
  /** Initial files, by `root:path` (`'home:notes/a.txt'`). Strings are stored as UTF-8. */
  files?: Record<string, string | Uint8Array | ArrayBuffer>
  /** The launch intent, delivered to the first `onIntent` subscriber (`{ root, openPath }` for a file). */
  intent?: unknown
  theme?: 'dark' | 'light'
  accent?: string
}

export type FakeSystem = {
  system: SystemHandle
  /** The current bytes of every file, by `root:path`. */
  files: Map<string, Uint8Array>
  /** Every fs call, in order, as `method root:path`. */
  fsCalls: string[]
  notifications: { title: string; body?: string; level?: string }[]
  titles: string[]
  recents: string[]
  openedApps: { appId: string; payload: unknown }[]
  /** Re-deliver an intent to the window, as File Manager does for an open window. */
  deliverIntent(payload: unknown): void
  /** Fire a compositor event. */
  emit<E extends SystemEvent>(event: E, payload: SystemEventMap[E]): void
  /** The registered close guard, if any. */
  closeGuard(): (() => boolean | Promise<boolean>) | null
}

export const fileKey = (root: string, path: string) => `${root}:${path}`

function toBytes(value: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value.slice(0))
}

function notFound(root: string, path: string): Error {
  return Object.assign(new Error(`Request failed with status code 404 (${root}:${path})`), {
    response: { status: 404 },
  })
}

export function createFakeSystem(options: FakeSystemOptions = {}): FakeSystem {
  const appId = options.appId ?? 'office-test'
  const windowId = options.windowId === undefined ? 'window-1' : options.windowId
  const files = new Map(Object.entries(options.files ?? {}).map(([k, v]) => [k, toBytes(v)]))
  const versions = new Map<string, number>([...files.keys()].map((k) => [k, 1]))
  const fsCalls: string[] = []
  const notifications: FakeSystem['notifications'] = []
  const titles: string[] = []
  const recents: string[] = []
  const openedApps: FakeSystem['openedApps'] = []
  const intentListeners = new Set<(payload: unknown) => void>()
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>()
  let pendingIntent = options.intent
  let guard: (() => boolean | Promise<boolean>) | null = null
  let appearance = { theme: options.theme ?? 'dark', accent: options.accent ?? '#c0263a' } as const

  const read = (root: string, path: string) => {
    const bytes = files.get(fileKey(root, path))
    if (!bytes) throw notFound(root, path)
    return bytes
  }
  const version = (root: string, path: string) => {
    const v = versions.get(fileKey(root, path))
    return v === undefined ? null : `v${v}`
  }

  const system: SystemHandle = {
    protocolVersion: 2,
    appId,
    windowId,
    fs: {
      async read(root, path) {
        fsCalls.push(`read ${fileKey(root, path)}`)
        return read(root, path).slice().buffer
      },
      async readWithVersion(root, path) {
        fsCalls.push(`readWithVersion ${fileKey(root, path)}`)
        return { bytes: read(root, path).slice().buffer, version: version(root, path) }
      },
      async upload(root, path, bytes, _name, opts) {
        fsCalls.push(`upload ${fileKey(root, path)}`)
        const key = fileKey(root, path)
        if (opts?.expected !== undefined && opts.expected !== version(root, path)) {
          throw new FileConflictError(version(root, path))
        }
        files.set(key, toBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))
        versions.set(key, (versions.get(key) ?? 0) + 1)
        return { version: version(root, path) }
      },
      downloadUrl: (root, path) =>
        `/fake-download/${encodeURIComponent(root)}/${encodeURIComponent(path)}`,
      pickOpen: async () => null,
      pickSave: async () => null,
      pickDirectory: async () => null,
      recordRecent: (root, path) => void recents.push(fileKey(root, path)),
      removeRecent: (root, path) => {
        const i = recents.indexOf(fileKey(root, path))
        if (i >= 0) recents.splice(i, 1)
      },
    },
    http: {
      get: async (url) => Promise.reject(new Error(`fake system: no HTTP (GET ${url})`)),
      delete: async (url) => Promise.reject(new Error(`fake system: no HTTP (DELETE ${url})`)),
      post: async (url) => Promise.reject(new Error(`fake system: no HTTP (POST ${url})`)),
      put: async (url) => Promise.reject(new Error(`fake system: no HTTP (PUT ${url})`)),
      patch: async (url) => Promise.reject(new Error(`fake system: no HTTP (PATCH ${url})`)),
    },
    window: {
      setTitle: (title) => void titles.push(title),
      requestClose: () => undefined,
      focus: () => undefined,
      hide: () => undefined,
      show: () => undefined,
      isFocused: () => true,
      isVisible: () => true,
      onCloseRequest(g) {
        guard = g
        return () => {
          if (guard === g) guard = null
        }
      },
    },
    intents: {
      openApp(target, payload) {
        openedApps.push({ appId: target, payload })
        return `window-of-${target}`
      },
      consume<T>() {
        const p = pendingIntent as T | undefined
        pendingIntent = undefined
        return p
      },
      onIntent(cb) {
        intentListeners.add(cb)
        if (pendingIntent !== undefined) {
          const p = pendingIntent
          pendingIntent = undefined
          cb(p)
        }
        return () => intentListeners.delete(cb)
      },
      associations: {
        resolveOpener: () => ({ appId, reason: 'none' }),
        candidatesFor: () => [],
        allCandidates: () => [],
        keyFor: (fileName) => {
          const dot = fileName.lastIndexOf('.')
          return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : fileName
        },
        openerName: () => null,
        setDefault: () => undefined,
      },
    },
    shortcuts: {
      register: () => () => undefined,
      document: () => () => undefined,
    },
    appearance: { get: () => appearance },
    schedule: { claim: async () => true },
    notify(input) {
      notifications.push({ title: input.title, body: input.body, level: input.level })
      return `notification-${notifications.length}`
    },
    on(event, cb) {
      const set = eventListeners.get(event) ?? new Set()
      eventListeners.set(event, set)
      const listener = cb as (payload: unknown) => void
      set.add(listener)
      return () => set.delete(listener)
    },
  }

  return {
    system,
    files,
    fsCalls,
    notifications,
    titles,
    recents,
    openedApps,
    deliverIntent(payload) {
      if (intentListeners.size === 0) pendingIntent = payload
      else intentListeners.forEach((l) => l(payload))
    },
    emit(event, payload) {
      if (event === 'appearance-changed') appearance = payload as typeof appearance
      eventListeners.get(event)?.forEach((l) => l(payload))
    },
    closeGuard: () => guard,
  }
}

/** A `host` prop as the desktop builds it for a static suite. */
export function fakeHost(overrides: Partial<NativeHostContext> = {}): NativeHostContext {
  return {
    appId: 'office-test',
    assetBase: 'http://localhost/api/marketplace/apps/imbatranim-office/b/test/',
    server: null,
    ...overrides,
  }
}
