import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SystemProvider, resetOpenedFilesForTest, type SystemHandle } from '@imbatranim/ui'

/**
 * Render a component the way the desktop does: inside a `SystemProvider`
 * holding the window's handle, in a real React root (the OS's own tests use the
 * same harness: jsdom, `createRoot`, `act`). Call from a test file that starts
 * with `// @vitest-environment jsdom`.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export type Rendered = {
  container: HTMLDivElement
  rerender(ui: ReactNode): void
  unmount(): void
}

const mounted = new Set<Rendered>()

export function renderWithSystem(ui: ReactNode, system: SystemHandle): Rendered {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const wrap = (node: ReactNode) => <SystemProvider system={system}>{node}</SystemProvider>
  act(() => root.render(wrap(ui)))
  const rendered: Rendered = {
    container,
    rerender: (next) => act(() => root.render(wrap(next))),
    unmount: () => {
      if (!mounted.delete(rendered)) return
      act(() => root.unmount())
      container.remove()
    },
  }
  mounted.add(rendered)
  return rendered
}

/**
 * Unmount everything {@link renderWithSystem} mounted, clear the body (dialogs
 * portal into it) and forget the files `useOpenIntent` latched: its store is
 * module-level, so it outlives a test. Call in `afterEach`.
 */
export function cleanupRendered(): void {
  for (const r of [...mounted]) r.unmount()
  document.body.innerHTML = ''
  resetOpenedFilesForTest()
}

/** Let pending promises (a file read, a worker reply) settle inside `act`. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Click the button whose text is `label`; throws when there is none. */
export function clickButton(label: string): void {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  )
  if (!button) throw new Error(`no "${label}" button on screen`)
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
