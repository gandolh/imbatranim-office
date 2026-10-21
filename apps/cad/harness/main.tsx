/**
 * The app in a plain page: a window-sized frame, the real `App`, and a fake
 * desktop handle whose files live in memory. `?open=<name>` opens a file
 * from /fixtures; `?theme=light` starts light; `?size=WxH` sizes the window. `window.__cadHarness` lets a
 * script choose what the Save and Open dialogs answer and read files back.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SystemProvider } from '@imbatranim/ui'
import { createFakeSystem, fakeHost } from '../../../packages/shared/src/testing/fakeSystem'
import { App } from '../src/App'

const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'light' ? 'light' : 'dark'
// ?size=WxH: the window's size (the descriptor's default is 1100×720).
const [frameW, frameH] = (params.get('size') ?? '1100x720').split('x').map(Number)
document.documentElement.dataset.theme = theme

type Harness = {
  /** What the next Save as / Export dialog answers (a path in `home`); null cancels. */
  nextSave: string | null
  nextOpen: string | null
  files(): string[]
  /** A file's bytes as base64, for copying out of the page. */
  base64(key: string): string | null
  text(key: string): string | null
  put(key: string, text: string): void
  setTheme(theme: 'dark' | 'light'): void
  titles: string[]
  notifications: { title: string; body?: string; level?: string }[]
}

async function main() {
  const open = params.get('open')
  const files: Record<string, Uint8Array> = {}
  if (open)
    files[`home:${open}`] = new Uint8Array(
      await (await fetch(`/fixtures/${encodeURIComponent(open)}`)).arrayBuffer()
    )
  const fake = createFakeSystem({
    appId: 'office-cad',
    files,
    intent: open ? { root: 'home', openPath: open } : undefined,
    theme,
  })
  const h: Harness = {
    nextSave: 'Drawings/room.dxf',
    nextOpen: null,
    files: () => [...fake.files.keys()],
    base64: (key) => {
      const b = fake.files.get(key)
      if (!b) return null
      let s = ''
      for (let i = 0; i < b.length; i += 0x8000)
        s += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return btoa(s)
    },
    text: (key) => {
      const b = fake.files.get(key)
      return b ? new TextDecoder().decode(b) : null
    },
    put: (key, text) => void fake.files.set(key, new TextEncoder().encode(text)),
    setTheme: (t) => {
      document.documentElement.dataset.theme = t
      fake.emit('appearance-changed', { theme: t, accent: '#c0263a' })
    },
    titles: fake.titles,
    notifications: fake.notifications,
  }
  fake.system.fs.pickSave = async (opts) => {
    const path = h.nextSave ?? null
    return path === null
      ? null
      : {
          root: 'home',
          path:
            opts?.extensions?.[0] && !path.toLowerCase().endsWith(`.${opts.extensions[0]}`)
              ? `${path.replace(/\.[^./]+$/, '')}.${opts.extensions[0]}`
              : path,
        }
  }
  fake.system.fs.pickOpen = async () => (h.nextOpen ? { root: 'home', path: h.nextOpen } : null)
  ;(window as unknown as { __cadHarness: Harness }).__cadHarness = h

  function Frame() {
    const [title, setTitle] = useState('CAD')
    useEffect(() => {
      const id = setInterval(() => setTitle(fake.titles.at(-1) ?? 'CAD'), 200)
      return () => clearInterval(id)
    }, [])
    return (
      <div className="harness-window" style={{ width: frameW, height: frameH }}>
        <div className="harness-title" data-testid="harness-title">
          {title}
        </div>
        <div className="harness-body">
          <SystemProvider system={fake.system}>
            <App windowId="window-1" host={fakeHost({ appId: 'office-cad' })} />
          </SystemProvider>
        </div>
      </div>
    )
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Frame />
    </StrictMode>
  )
}

void main()
