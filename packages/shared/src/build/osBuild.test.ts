import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkUtilitiesOnly } from './cssRule.ts'
import { readKitSnapshot } from './kitSnapshot.ts'
import { appStylePaths, discoverApps, osBuildConfig } from './osBuild.ts'
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

describe('vendor stylesheets', () => {
  let out: string
  beforeAll(async () => {
    out = await buildRepo(join(fixtures, 'vendor-styles'))
  }, 60_000)

  it('copies each declared stylesheet beside app.css, byte for byte but for its dropped rules', () => {
    expect(files(out).filter((f) => f.startsWith('v/'))).toEqual([
      'v/app.css',
      'v/app.mjs',
      'v/extra.css',
      'v/widget.css',
    ])
    const source = (name: string) =>
      readFileSync(join(fixtures, 'vendor-styles', 'apps', 'v', 'lib', name), 'utf8')
    expect(readFileSync(join(out, 'v', 'widget.css'), 'utf8')).toBe(source('widget.css'))
    // extra.css declares its `*` rule dropped: gone, and every other byte kept.
    const dropped = '* {\n  scrollbar-width: initial;\n}'
    expect(source('extra.css')).toContain(dropped)
    expect(readFileSync(join(out, 'v', 'extra.css'), 'utf8')).toBe(
      source('extra.css').replace(dropped, '')
    )
    // app.css stays utilities only: the vendor's classes are not compiled into it.
    const appCss = readFileSync(join(out, 'v', 'app.css'), 'utf8')
    expect(checkUtilitiesOnly(appCss)).toEqual([])
    expect(appCss).not.toContain('wd-toolbar')
  })

  it("lists app.css and then the vendor sheets, in declared order, as the descriptor's styles", () => {
    const [app] = discoverApps(join(fixtures, 'vendor-styles'))
    expect(appStylePaths(app)).toEqual(['v/app.css', 'v/widget.css', 'v/extra.css'])
    expect(app.vendorStyles[0]).toMatchObject({
      specifier: './lib/widget.css',
      ownAttributes: ['data-widget-root'],
    })
    expect(app.vendorStyles[1].ownAttributes).toEqual([])
  })

  it('replaces process.env, so a guarded read in bundled code never reaches the browser', () => {
    const mjs = readFileSync(join(out, 'v', 'app.mjs'), 'utf8')
    expect(mjs).not.toMatch(/\bprocess\.env\b/)
    expect(mjs).toContain('FORCE_COLOR')
    // process.env.NODE_ENV is still "production", not a read of the empty object.
    expect(mjs).toContain('"production"')
    expect(mjs).not.toContain('NODE_ENV')
  })
})

describe('the OS build fails', () => {
  it('when a declared drop is not in the vendor stylesheet exactly once', async () => {
    await expect(buildRepo(join(fixtures, 'bad-vendor-drop'))).rejects.toThrow(
      /d\/lib\.css \(\.\/lib\/lib\.css\): dropRules do not match the sheet:[\s\S]*"p \{\n {2}margin: 0;\n\}" is in the sheet 2 times as a top-level rule, not once[\s\S]*"\.gone \{\n {2}color: red;\n\}" is in the sheet 0 times/
    )
  })

  it('when a vendor stylesheet would restyle the desktop', async () => {
    await expect(buildRepo(join(fixtures, 'bad-vendor-global'))).rejects.toThrow(
      /g\/lib\.css \(\.\/lib\/lib\.css\) would restyle the desktop[\s\S]*global: "p"[\s\S]*token: ":root" sets the desktop's --spacing/
    )
  })

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
  let out: string
  beforeAll(async () => {
    out = await buildRepo(repoRoot)
  }, 120_000)

  /** An entry and every chunk it imports, statically or dynamically: what loads with it. */
  function loaded(entry: string): string {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const code = readFileSync(join(out, file), 'utf8')
      for (const m of code.matchAll(/(?:from |import\()"(\.\.?\/[^"]+\.mjs)"/g)) {
        visit(join(file, '..', m[1]).split('\\').join('/'))
      }
    }
    visit(entry)
    return [...seen].map((f) => readFileSync(join(out, f), 'utf8')).join('\n')
  }

  it('matches os/descriptor.template.json: one entry per app, its entry and styles emitted', () => {
    type TemplateApp = { id: string; entry: string; styles: string[] }
    const template = JSON.parse(
      readFileSync(join(repoRoot, 'os', 'descriptor.template.json'), 'utf8')
    ) as {
      sharedKit: number
      build: { install: string[]; command: string[]; output: string }
      apps: TemplateApp[]
    }
    const apps = discoverApps(repoRoot)
    expect(template.apps.map((a) => a.entry).sort()).toEqual(
      apps.map((a) => `${a.name}/app.mjs`).sort()
    )
    for (const app of apps) {
      const entry = template.apps.find((a) => a.entry === `${app.name}/app.mjs`)!
      expect(entry.id).toBe(`office-${app.name}`)
      expect(entry.styles, entry.id).toEqual(appStylePaths(app))
      for (const file of [entry.entry, ...entry.styles]) {
        expect(existsSync(join(out, file)), file).toBe(true)
      }
    }
    // The build the OS runs is this one, writing where the descriptor says it does.
    expect(template.build).toEqual({
      install: ['npm', 'ci'],
      command: ['npm', 'run', 'build:os'],
      output: 'dist/os',
    })
    const outDir = osBuildConfig({ root: repoRoot }).build?.outDir ?? ''
    expect(relative(repoRoot, outDir).split('\\').join('/')).toBe(template.build.output)
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['build:os']).toBe('vite build')
    // Built against the snapshot's kit version, which the desktop checks.
    expect(template.sharedKit).toBe(readKitSnapshot(vendorDir).sharedKitVersion)
  })

  it("builds Docs with SuperDoc loaded on first open and SuperDoc's stylesheet beside it", () => {
    const entry = readFileSync(join(out, 'docs', 'app.mjs'), 'utf8')
    const all = loaded('docs/app.mjs')
    expect(entry).toMatch(/export \{ \w+ as App \}/)
    // SuperDoc is its own chunk, imported dynamically: opening a window loads
    // Docs' UI, the editor arrives with the first document, as in the built-in.
    expect(entry).toMatch(/import\("\.\.\/chunks\/superdoc\.es-[\w-]+\.mjs"\)/)
    expect(entry).not.toMatch(/from "\.\.\/chunks\/superdoc/)
    expect(all).not.toMatch(BARE_SHARED_IMPORT)
    expect(all).not.toMatch(/\bprocess\.env\b/)
    expect(all).toMatch(/\w\("@imbatranim\/ui", "useOpenIntent"\)/)
    // Minified: sharedExport is a one-letter function, its arguments stay readable.
    expect(all).toMatch(/\w\("react\/jsx-runtime", "jsx"\)/)
    // SuperDoc's style.css, as the built-in loaded it, under the vendor rule.
    const [docs] = discoverApps(repoRoot).filter((a) => a.name === 'docs')
    expect(appStylePaths(docs)).toEqual(['docs/app.css', 'docs/superdoc.css'])
    expect(readFileSync(join(out, 'docs', 'superdoc.css'))).toEqual(
      readFileSync(docs.vendorStyles[0].path)
    )
    expect(docs.vendorStyles[0].path).toMatch(/@harbour-enterprises\/superdoc\/dist\/style\.css$/)
    const css = readFileSync(join(out, 'docs', 'app.css'), 'utf8')
    expect(checkUtilitiesOnly(css)).toEqual([])
    expect(css).not.toMatch(/--color-[\w-]+:/)
  })

  it("builds Sheets with its xlsx worker as a file and Univer's stylesheet beside it", () => {
    const entry = readFileSync(join(out, 'sheets', 'app.mjs'), 'utf8')
    const all = loaded('sheets/app.mjs')
    expect(entry).toMatch(/export \{ \w+ as App \}/)
    expect(all).not.toMatch(BARE_SHARED_IMPORT)
    expect(all).not.toMatch(/\bprocess\.env\b/)
    // The OS's CSP refuses blob: workers: the worker is its own file, loaded
    // by a URL relative to the module, and ExcelJS lives only in it.
    const workers = files(out).filter((f) => /^workers\/xlsxWorker-[\w-]+\.mjs$/.test(f))
    expect(workers).toHaveLength(1)
    expect(all).toContain(`new URL("../${workers[0]}", import.meta.url)`)
    expect(all).not.toContain('exceljs')
    // Univer's stylesheet, as the built-in loaded it, under the vendor rule,
    // without the one rule Sheets declares dropped.
    const [sheets] = discoverApps(repoRoot).filter((a) => a.name === 'sheets')
    expect(appStylePaths(sheets)).toEqual(['sheets/app.css', 'sheets/univer.css'])
    const dropped = '*{scrollbar-color:initial;scrollbar-width:initial}'
    expect(sheets.vendorStyles[0].dropRules).toEqual([dropped])
    const source = readFileSync(sheets.vendorStyles[0].path, 'utf8')
    expect(source.split(dropped)).toHaveLength(2)
    expect(readFileSync(join(out, 'sheets', 'univer.css'), 'utf8')).toBe(
      source.replace(dropped, '')
    )
    expect(checkUtilitiesOnly(readFileSync(join(out, 'sheets', 'app.css'), 'utf8'))).toEqual([])
  })
})
