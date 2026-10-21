import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import { build, type Plugin } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reactExports } from './exportNames.ts'
import {
  BARE_SHARED_IMPORT,
  SHARED_SPECIFIERS,
  noSharedKitInWorkers,
  sharedKitExternals,
  sharedModuleSource,
  type SharedExports,
} from './sharedKit.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const fixtures = fileURLToPath(new URL('../../test/fixtures/externals/', import.meta.url))
const entries = ['named', 'default', 'namespace', 'reexport', 'dynamic', 'kit']

type Shared = { version: number; modules: Record<string, unknown> }
const g = globalThis as { __imbatranimShared?: Shared }

/** A stand-in for the desktop's kit namespace: only identity matters here. */
const kitNamespace = Object.freeze({ Button: () => null, useSystem: () => null })

function sharedExports(): SharedExports {
  return {
    ...reactExports(repoRoot),
    '@imbatranim/ui': { names: ['Button', 'useSystem'], hasDefault: false },
  }
}

async function buildFixtures(outDir: string, plugins: Plugin[]) {
  await build({
    configFile: false,
    root: fixtures,
    logLevel: 'silent',
    plugins,
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: Object.fromEntries(
          entries.map((e) => [e, join(fixtures, `${e}.${e === 'named' ? 'tsx' : 'ts'}`)])
        ),
        formats: ['es'],
        fileName: (_f, name) => `${name}.mjs`,
      },
      rolldownOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].mjs' } },
    },
  })
}

function allCode(dir: string): string {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
}

let work: string
let out: string

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'imbatranim-externals-'))
  out = join(work, 'built')
  await buildFixtures(out, [sharedKitExternals({ exports: sharedExports })])
}, 60_000)

afterAll(() => {
  delete g.__imbatranimShared
  rmSync(work, { recursive: true, force: true })
})

describe('the externals', () => {
  it('leave no bare import of the five shared specifiers in the output', () => {
    const code = allCode(out)
    expect(code).not.toMatch(BARE_SHARED_IMPORT)
    for (const s of SHARED_SPECIFIERS) {
      expect(code).not.toMatch(
        new RegExp(`(from|import)\\s*\\(?\\s*["']${s.replace('/', '\\/')}["']`)
      )
    }
    expect(code).toContain('globalThis.__imbatranimShared')
  })

  it('tree-shake the exports nothing uses', async () => {
    // Alone: namespace.ts lets the whole React namespace escape, which keeps every name.
    const dir = join(work, 'named-only')
    await build({
      configFile: false,
      root: fixtures,
      logLevel: 'silent',
      plugins: [sharedKitExternals({ exports: sharedExports })],
      build: {
        outDir: dir,
        minify: false,
        lib: {
          entry: { named: join(fixtures, 'named.tsx') },
          formats: ['es'],
          fileName: () => 'named.mjs',
        },
      },
    })
    const code = allCode(dir)
    expect(code).toContain('sharedExport("react", "useState")')
    expect(code).toContain('sharedExport("react/jsx-runtime", "jsxs")')
    expect(code).not.toContain('"useReducer"')
    expect(code).not.toContain('"useEffect"')
    expect(code).not.toContain('sharedDefault')
  })

  it('throw a sentence when the desktop has not set the global', async () => {
    delete g.__imbatranimShared
    await expect(import(pathToFileURL(join(out, 'named.mjs')).href)).rejects.toThrow(
      /the desktop lends no "react"/
    )
  })

  describe('with the desktop global set', () => {
    let copy: string
    beforeAll(() => {
      // A fresh copy: the failed import above is cached by URL.
      copy = join(work, 'with-global')
      cpSync(out, copy, { recursive: true })
      g.__imbatranimShared = Object.freeze({
        version: 1,
        modules: Object.freeze({
          react: React,
          'react/jsx-runtime': JsxRuntime,
          'react-dom': ReactDom,
          'react-dom/client': ReactDomClient,
          '@imbatranim/ui': kitNamespace,
        }),
      })
    })
    const load = (name: string) => import(pathToFileURL(join(copy, `${name}.mjs`)).href)

    it('read named imports from the global, by identity', async () => {
      const { refs } = await load('named')
      expect(refs.useState).toBe(React.useState)
      expect(refs.createContext).toBe(React.createContext)
    })

    it("resolve the JSX transform's jsx, jsxs and Fragment to the desktop's runtime", async () => {
      const { Hello } = await load('named')
      const element = Hello()
      expect(React.isValidElement(element)).toBe(true)
      expect(element.type).toBe(React.Fragment)
      expect(element.props.children.map((c: React.ReactElement) => c.type)).toEqual(['b', 'i'])
    })

    it('read a default import as the whole module', async () => {
      const { defaultReact } = await load('default')
      expect(defaultReact).toBe((React as unknown as { default: unknown }).default)
      expect((defaultReact as typeof React).useState).toBe(React.useState)
    })

    it("give a namespace import the desktop's members", async () => {
      const { namespace, kitButton } = await load('namespace')
      expect(namespace.useState).toBe(React.useState)
      expect(namespace.createElement).toBe(React.createElement)
      expect(kitButton).toBe(kitNamespace.Button)
    })

    it('carry named and star re-exports through', async () => {
      const mod = await load('reexport')
      expect(mod.useMemo).toBe(React.useMemo)
      expect(mod.createRoot).toBe(ReactDomClient.createRoot)
    })

    it('serve a dynamic import from the global', async () => {
      const { loadReactDom } = await load('dynamic')
      const dom = await loadReactDom()
      expect(dom.createPortal).toBe(ReactDom.createPortal)
    })

    it('read a name the desktop lacks as undefined, without stopping the module', async () => {
      const saved = g.__imbatranimShared!
      const lacking = join(work, 'lacking')
      cpSync(out, lacking, { recursive: true })
      g.__imbatranimShared = {
        version: 1,
        modules: { ...saved.modules, '@imbatranim/ui': { Button: kitNamespace.Button } },
      }
      try {
        const { kit } = await import(pathToFileURL(join(lacking, 'kit.mjs')).href)
        expect(kit.Button).toBe(kitNamespace.Button)
        expect(kit.useSystem).toBeUndefined()
      } finally {
        g.__imbatranimShared = saved
      }
    })

    it('read the kit from the global', async () => {
      const { kit } = await load('kit')
      expect(kit.Button).toBe(kitNamespace.Button)
      expect(kit.useSystem).toBe(kitNamespace.useSystem)
      expect(kit.useState).toBe(React.useState)
    })
  })

  it('fail the build on a name the shared module does not export', async () => {
    const exports = sharedExports()
    const narrowed: SharedExports = {
      ...exports,
      react: { ...exports.react, names: exports.react.names.filter((n) => n !== 'createContext') },
    }
    await expect(
      buildFixtures(join(work, 'missing'), [sharedKitExternals({ exports: narrowed })])
    ).rejects.toThrow(/createContext/)
  })

  it("refuse a deep import of the kit, the desktop's core and development JSX", async () => {
    const plugin = sharedKitExternals({ exports: sharedExports })
    const resolveId = plugin.resolveId as (this: unknown, source: string) => unknown
    const context = {
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(() => resolveId.call(context, '@imbatranim/ui/components/Button')).toThrow(/one module/)
    expect(() => resolveId.call(context, '@imbatranim/core')).toThrow(/useSystem/)
    expect(() => resolveId.call(context, 'react/jsx-dev-runtime')).toThrow(/production/)
    expect(resolveId.call(context, 'react-dom/server')).toBeNull()
  })

  it('refuse the shared kit inside a worker bundle', () => {
    const plugin = noSharedKitInWorkers()
    const resolveId = plugin.resolveId as (
      this: unknown,
      source: string,
      importer?: string
    ) => unknown
    const context = {
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(() => resolveId.call(context, 'react', '/app/x.worker.ts')).toThrow(/inside a worker/)
    expect(resolveId.call(context, './lines', '/app/x.worker.ts')).toBeNull()
  })

  it('write every export as a pure read, aliasing names that are not identifiers', () => {
    const source = sharedModuleSource('@imbatranim/ui', {
      names: ['Button', 'delete', 'a-b'],
      hasDefault: false,
    })
    expect(source).toContain(
      'export const Button = /* @__PURE__ */ sharedExport("@imbatranim/ui", "Button");'
    )
    expect(source).toMatch(
      /const e1 = \/\* @__PURE__ \*\/ sharedExport\("@imbatranim\/ui", "delete"\);\nexport \{ e1 as "delete" \};/
    )
    expect(source).toContain('export { e2 as "a-b" };')
    expect(source).not.toContain('export default')
  })
})
