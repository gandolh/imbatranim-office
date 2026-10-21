import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { checkVendorCss, desktopVariables, readVendorStyles } from './vendorCss.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const require = createRequire(import.meta.url)
// SuperDoc is Docs' dependency: resolve it as apps/docs does.
const superdocCss = createRequire(join(repoRoot, 'apps', 'docs', 'package.json')).resolve(
  '@harbour-enterprises/superdoc/style.css'
)
const isDesktopVariable = desktopVariables([
  readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8'),
  readFileSync(join(repoRoot, 'vendor', 'imbatranim-ui', 'theme.provisional.css'), 'utf8'),
])

const kinds = (css: string, ownAttributes: string[] = []) =>
  checkVendorCss(css, { isDesktopVariable, ownAttributes }).map((p) => p.kind)

describe('desktopVariables', () => {
  it("knows the kit's tokens, the values they read, and Tailwind's namespaces", () => {
    for (const name of [
      '--color-primary',
      '--color-anything-new',
      '--k-surface',
      '--accent',
      '--spacing',
      '--font-ui',
      '--text-sm',
      '--radius-lg',
      '--tw-ring-color',
    ]) {
      expect(isDesktopVariable(name), name).toBe(true)
    }
    for (const name of ['--sd-color-blue-500', '--sd-ui-font-family', '--wd-gap', '--offset']) {
      expect(isDesktopVariable(name), name).toBe(false)
    }
  })
})

describe('the vendor rule', () => {
  it("passes SuperDoc 1.45.0's style.css once Tippy's root attribute is declared its own", () => {
    const css = readFileSync(superdocCss, 'utf8')
    expect(checkVendorCss(css, { isDesktopVariable, ownAttributes: ['data-tippy-root'] })).toEqual(
      []
    )
    // Undeclared, the one rule SuperDoc keys on Tippy's attribute alone is refused.
    expect(checkVendorCss(css, { isDesktopVariable })).toEqual([
      {
        kind: 'global',
        detail: `"[data-tippy-root]" is not tied to the library's own elements (no class or id of its own)`,
      },
    ])
  })

  it("allows rules tied to the library's own classes, ids and Vue-scoped elements", () => {
    expect(kinds('.sd-toolbar button:hover{color:red}')).toEqual([])
    expect(kinds('#sd-root{color:red}')).toEqual([])
    expect(kinds('img[data-v-c95b2073]{max-width:100%}')).toEqual([])
    expect(kinds('.sd-x[data-state=open]{opacity:1}')).toEqual([])
    expect(kinds('.a :is(span,br){x:1}')).toEqual([])
    expect(kinds(':where(.sd-x) p{x:1}')).toEqual([])
    expect(kinds('.sd-x{&:hover{color:red} p{color:blue}}')).toEqual([])
    expect(
      kinds('@media (max-width:600px){@supports (display:grid){.sd-x{display:grid}}}')
    ).toEqual([])
    expect(kinds('@layer sd{.sd-x{color:red}}@layer a,b;@charset "utf-8";')).toEqual([])
    expect(kinds('@keyframes sd-blink{from{opacity:0}to{opacity:1}}')).toEqual([])
    expect(kinds('.sd-x{background:url("data:image/svg+xml;utf8,<svg/>")}')).toEqual([])
    expect(
      kinds(`.sd-x{mask:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>")}`)
    ).toEqual([])
  })

  it('allows its own variables on :root, where its popups in <body> read them', () => {
    expect(kinds(':root{--sd-gap:4px;--sd-accent:#1355ff}')).toEqual([])
    expect(kinds(':root.dark{--sd-gap:8px}')).toEqual([])
  })

  it('refuses rules that reach elements by type or by a common attribute alone', () => {
    for (const css of [
      'p{margin:0}',
      '*{box-sizing:border-box}',
      'img:hover{opacity:.5}',
      '::selection{color:red}',
      '[hidden]{display:none}',
      '[data-theme=dark]{color:red}',
      'p:not(.sd-x){color:red}',
      'li:has(.sd-x){color:red}',
      ':is(span,.sd-x){color:red}',
      '@media (x){p{a:1}}',
      '@layer base{button{a:1}}',
    ]) {
      expect(kinds(css), css).toEqual(['global'])
    }
  })

  it("refuses styling the desktop's document, its classes included", () => {
    expect(kinds('html{font-size:10px}')).toEqual(['global'])
    expect(kinds('body{margin:0}')).toEqual(['global'])
    expect(kinds('body.dark p{color:red}')).toEqual(['global'])
    expect(kinds(':root{color:red}')).toEqual(['global'])
    expect(kinds(':root.dark{color:red}')).toEqual(['global'])
    expect(kinds(':root,.sd-x{color:red}')).toEqual(['global'])
  })

  it("refuses the desktop's tokens and variables", () => {
    expect(checkVendorCss(':root{--spacing:2px}', { isDesktopVariable })).toEqual([
      { kind: 'token', detail: `":root" sets the desktop's --spacing` },
    ])
    expect(kinds(':root{--k-surface:#fff}')).toEqual(['token'])
    expect(kinds(':root{--color-x:red}')).toEqual(['token'])
    expect(kinds('.sd-x{--color-y:red}')).toEqual(['token'])
    expect(kinds('@property --tw-shadow{syntax:"*"}')).toEqual(['token'])
  })

  it('refuses what would load a file the build does not copy', () => {
    expect(kinds('.sd-x{background:url(icons.png)}')).toEqual(['external'])
    expect(kinds(`.sd-x{background:url("icons/it's.png")}`)).toEqual(['external'])
    expect(kinds(".sd-x{background:url('https://cdn.example/x.svg')}")).toEqual(['external'])
    expect(kinds('@import "other.css";')).toEqual(['external'])
    expect(kinds('@font-face{font-family:Inter;src:url(data:font/woff2;base64,AA)}')).toEqual([
      'external',
    ])
  })

  it('refuses at-rules it does not know', () => {
    expect(kinds('@page{margin:0}')).toEqual(['unsupported'])
    expect(kinds('@scope (.sd-x){p{color:red}}')).toEqual(['unsupported'])
  })
})

describe('readVendorStyles', () => {
  const dirs: string[] = []
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

  function app(pkg: unknown, files: Record<string, string> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'imbatranim-vendor-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      writeFileSync(join(dir, name), text)
    }
    return dir
  }

  it('reads nothing from an app without a package.json or without the field', () => {
    expect(readVendorStyles(join(tmpdir(), 'no-such-app-dir'), 'x')).toEqual([])
    expect(readVendorStyles(app({ name: 'x' }), 'x')).toEqual([])
  })

  it("resolves a package export from the app's dependencies, in the object form", () => {
    expect(readVendorStyles(join(repoRoot, 'apps', 'docs'), 'docs')).toEqual([
      {
        fileName: 'superdoc.css',
        specifier: '@harbour-enterprises/superdoc/style.css',
        path: superdocCss,
        ownAttributes: ['data-tippy-root'],
      },
    ])
  })

  it('resolves a relative path from the app, in the shorthand form', () => {
    const dir = app(
      { imbatranimOffice: { vendorStyles: { 'mine.css': './lib/mine.css' } } },
      { 'lib/mine.css': '.m{color:red}' }
    )
    expect(readVendorStyles(dir, 'x')).toEqual([
      {
        fileName: 'mine.css',
        specifier: './lib/mine.css',
        path: join(dir, 'lib', 'mine.css'),
        ownAttributes: [],
      },
    ])
  })

  it('refuses a declaration the build could not honour', () => {
    const styles = (vendorStyles: unknown) => app({ imbatranimOffice: { vendorStyles } })
    expect(() => readVendorStyles(app({ imbatranimOffice: [] }), 'x')).toThrow(/is an object/)
    expect(() => readVendorStyles(styles(['a.css']), 'x')).toThrow(/maps a file name/)
    expect(() => readVendorStyles(styles({ 'app.css': './a.css' }), 'x')).toThrow(/not be app\.css/)
    expect(() => readVendorStyles(styles({ 'Lib.css': './a.css' }), 'x')).toThrow(/lowercase/)
    expect(() => readVendorStyles(styles({ 'lib.css': {} }), 'x')).toThrow(/give "from"/)
    expect(() =>
      readVendorStyles(styles({ 'lib.css': { from: './a.css', ownAttributes: ['class'] } }), 'x')
    ).toThrow(/data-\* attribute names/)
    expect(() => readVendorStyles(styles({ 'lib.css': 'no-such-package/x.css' }), 'x')).toThrow(
      /cannot resolve "no-such-package\/x\.css" from apps\/x/
    )
    const eight = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`s${i}.css`, `./s${i}.css`])
    )
    expect(() => readVendorStyles(styles(eight), 'x')).toThrow(/at most 7/)
    const notCss = app(
      { imbatranimOffice: { vendorStyles: { 'lib.css': './lib/x.js' } } },
      { 'lib/x.js': '' }
    )
    expect(() => readVendorStyles(notCss, 'x')).toThrow(/is not a \.css file/)
  })
})
