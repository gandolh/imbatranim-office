import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkUtilitiesOnly } from './cssRule.ts'
import { discoverApps, osBuildConfig } from './osBuild.ts'
import { BARE_SHARED_IMPORT } from './sharedKit.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const fixtures = fileURLToPath(new URL('../../test/fixtures/os/', import.meta.url))
const vendorDir = join(repoRoot, 'vendor', 'imbatranim-ui')

const outDirs: string[] = []
afterAll(() => outDirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

async function buildRepo(root: string): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'imbatranim-os-build-'))
  outDirs.push(outDir)
  await build({
    ...osBuildConfig({ root, outDir, vendorDir }),
    configFile: false,
    logLevel: 'silent',
  })
  return outDir
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.includes('.'))
    .map((f) => f.split('\\').join('/'))
    .sort()
}

describe('discoverApps', () => {
  it('takes every apps/<name> with src/App.tsx, sorted, and skips the rest', () => {
    expect(discoverApps(join(fixtures, 'good')).map((a) => a.name)).toEqual(['alpha', 'beta'])
  })

  it('refuses an app directory the OS could not serve under its name', () => {
    const root = mkdtempSync(join(tmpdir(), 'imbatranim-discover-'))
    outDirs.push(root)
    mkdirSync(join(root, 'apps', 'My_App', 'src'), { recursive: true })
    writeFileSync(join(root, 'apps', 'My_App', 'src', 'App.tsx'), 'export const App = () => null\n')
    expect(() => discoverApps(root)).toThrow(/lowercase/)
  })
})

describe('the OS build of a two-app suite', () => {
  let out: string
  beforeAll(async () => {
    out = await buildRepo(join(fixtures, 'good'))
  }, 60_000)

  it('writes <app>/app.mjs and <app>/app.css per app, with shared chunks and workers beside them', () => {
    const emitted = files(out)
    expect(emitted).toEqual(
      expect.arrayContaining(['alpha/app.css', 'alpha/app.mjs', 'beta/app.css', 'beta/app.mjs'])
    )
    expect(emitted.filter((f) => /^chunks\/.+\.mjs$/.test(f))).toHaveLength(1)
    expect(emitted.filter((f) => /^workers\/sum\.worker-.+\.mjs$/.test(f))).toHaveLength(1)
    expect(emitted.every((f) => /^(alpha|beta|chunks|workers)\//.test(f))).toBe(true)
  })

  it('loads the worker as a file, by a URL relative to the module', () => {
    const alpha = readFileSync(join(out, 'alpha', 'app.mjs'), 'utf8')
    expect(alpha).toMatch(/new URL\("\.\.\/workers\/sum\.worker-[\w-]+\.mjs", import\.meta\.url\)/)
    expect(alpha).not.toMatch(/data:|blob:/)
    const worker = files(out).find((f) => f.startsWith('workers/'))!
    expect(readFileSync(join(out, worker), 'utf8')).toContain('postMessage')
  })

  it('reaches shared chunks by relative imports', () => {
    for (const app of ['alpha', 'beta']) {
      expect(readFileSync(join(out, app, 'app.mjs'), 'utf8')).toMatch(
        /from "\.\.\/chunks\/[\w-]+\.mjs"/
      )
    }
  })

  it('imports none of the five shared specifiers and never reads process.env', () => {
    for (const f of files(out).filter((f) => f.endsWith('.mjs'))) {
      const code = readFileSync(join(out, f), 'utf8')
      expect(code, f).not.toMatch(BARE_SHARED_IMPORT)
      expect(code, f).not.toMatch(/\bprocess\.env\b/)
    }
  })

  it('gives each app a stylesheet of its own classes only, kit classes left to the desktop', () => {
    const alpha = readFileSync(join(out, 'alpha', 'app.css'), 'utf8')
    const beta = readFileSync(join(out, 'beta', 'app.css'), 'utf8')
    expect(alpha).toContain('.tracking-widest')
    expect(alpha).not.toContain('.underline')
    expect(beta).toContain('.underline')
    expect(beta).toContain('color:var(--color-primary,var(--accent))')
    expect(beta).not.toContain('.tracking-widest')
    expect(beta).not.toContain('skew-x-12') // used only in a test file
    // The kit's Button classes come from the desktop's own CSS.
    expect(alpha).not.toContain('bg-surface-container-low')
    expect(checkUtilitiesOnly(alpha)).toEqual([])
    expect(checkUtilitiesOnly(beta)).toEqual([])
  })
})

describe('the OS build fails', () => {
  it('when an app stylesheet defines a token', async () => {
    await expect(buildRepo(join(fixtures, 'bad-token'))).rejects.toThrow(
      /tokens\/app\.css breaks the CSS rule[\s\S]*token: defines the token --color-brand/
    )
  })

  it('when an app stylesheet brings preflight', async () => {
    await expect(buildRepo(join(fixtures, 'bad-preflight'))).rejects.toThrow(
      /reset\/app\.css breaks the CSS rule[\s\S]*preflight/
    )
  })

  it('when a worker imports React', async () => {
    await expect(buildRepo(join(fixtures, 'bad-worker'))).rejects.toThrow(/inside a worker/)
  })

  it('when App.tsx does not export App', async () => {
    await expect(buildRepo(join(fixtures, 'no-app-export'))).rejects.toThrow(/must export App/)
  })

  it('when JS imports CSS', async () => {
    await expect(buildRepo(join(fixtures, 'css-import'))).rejects.toThrow(/CSS imported from JS/)
  })
})

describe("this repo's own build", () => {
  it('builds the smoke app to the acceptance shape', async () => {
    const out = await buildRepo(repoRoot)
    const mjs = readFileSync(join(out, 'smoke', 'app.mjs'), 'utf8')
    const css = readFileSync(join(out, 'smoke', 'app.css'), 'utf8')
    expect(mjs).not.toMatch(BARE_SHARED_IMPORT)
    // Minified: sharedExport is a one-letter function, its arguments stay readable.
    expect(mjs).toMatch(/\w\("@imbatranim\/ui", "ConfirmDialog"\)/)
    expect(mjs).toMatch(/\w\("react\/jsx-runtime", "jsx"\)/)
    expect(mjs).toMatch(/new URL\("\.\.\/workers\/lines\.worker-[\w-]+\.mjs", import\.meta\.url\)/)
    expect(checkUtilitiesOnly(css)).toEqual([])
    expect(css).not.toMatch(/--color-[\w-]+:/)
  }, 60_000)
})
