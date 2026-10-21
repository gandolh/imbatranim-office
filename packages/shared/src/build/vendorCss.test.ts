import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { readKitSnapshot } from './kitSnapshot.ts'
import { checkVendorCss, desktopVariables, dropVendorRules, readVendorStyles } from './vendorCss.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const require = createRequire(import.meta.url)
// SuperDoc is Docs' dependency: resolve it as apps/docs does.
const superdocCss = createRequire(join(repoRoot, 'apps', 'docs', 'package.json')).resolve(
  '@harbour-enterprises/superdoc/style.css'
)
// Univer is Sheets' dependency.
const univerCss = createRequire(join(repoRoot, 'apps', 'sheets', 'package.json')).resolve(
  '@univerjs/preset-sheets-core/lib/index.css'
)
const isDesktopVariable = desktopVariables([
  readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8'),
  readFileSync(readKitSnapshot(join(repoRoot, 'vendor', 'imbatranim-ui')).themeCss, 'utf8'),
])

const kinds = (css: string, ownAttributes: string[] = [], ownCustomProperties: string[] = []) =>
  checkVendorCss(css, { isDesktopVariable, ownAttributes, ownCustomProperties }).map((p) => p.kind)

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

  it('reads escaped characters as part of the class they sit in', () => {
    // Tailwind's variant classes, as Univer's sheet has them.
    expect(kinds('.before\\:univer-absolute:before{position:absolute}')).toEqual([])
    expect(
      kinds('.before\\:univer-content-\\[\\"\\"\\]:before{--univer-tw-content:"";content:""}')
    ).toEqual([])
    expect(
      kinds(
        '.\\[\\&_\\[data-sonner-toast\\]\\]\\:univer-backdrop-blur-sm [data-sonner-toast]{color:red}'
      )
    ).toEqual([])
    expect(
      kinds('.univer-w-1\\/2,.univer-transition-\\[colors\\,box-shadow\\]{width:50%}')
    ).toEqual([])
    expect(kinds('.data-\\[state\\=open\\]\\:univer-bg-gray-100[data-state=open]{x:1}')).toEqual([])
    // A hex escape takes the space after it: one class `x1html`, not `.x1` and then html.
    expect(kinds('.x\\31 html{color:red}')).toEqual([])
    // An escaped colon is not a pseudo-class: this is a class, not :root.
    expect(kinds('.a\\:root{color:red}')).toEqual([])
  })

  it('does not read a class or an attribute into an escaped type name', () => {
    expect(kinds('x\\.y{color:red}')).toEqual(['global'])
    expect(kinds('x\\[data-v-1\\]{color:red}')).toEqual(['global'])
    expect(kinds('\\*{color:red}')).toEqual(['global'])
  })

  it('reads property names with their escapes decoded', () => {
    expect(kinds('.sd-x{--colo\\72-x:red}')).toEqual(['token'])
    expect(kinds(':root{--t\\77-ring-color:red}')).toEqual(['token'])
  })
})

describe('own custom properties', () => {
  // Univer's Tailwind initialiser, shortened.
  const reset = '*,:before,:after,::backdrop{--univer-tw-translate-x:0;--univer-tw-pan-x: }'

  it('lets a rule on any element set the declared namespaces, and nothing else', () => {
    expect(kinds(reset, [], ['--univer-'])).toEqual([])
    expect(kinds('p{--univer-gap:4px}::selection{--univer-x:1}', [], ['--univer-'])).toEqual([])
    expect(kinds(reset, [], ['--lib-', '--univer-'])).toEqual([])
    // Undeclared, the initialiser is four global rules, as before.
    expect(kinds(reset)).toEqual(['global', 'global', 'global', 'global'])
  })

  it('refuses the rule when one declaration is not an own custom property', () => {
    const withColor = '*{--univer-a:0;color:red}'
    expect(
      checkVendorCss(withColor, { isDesktopVariable, ownCustomProperties: ['--univer-'] })
    ).toEqual([
      {
        kind: 'global',
        detail: `"*" is not tied to the library's own elements (no class or id of its own), and color is not one of its own custom properties (--univer-*)`,
      },
    ])
    expect(kinds('*{--univer-a:0;--tw-x:0}', [], ['--univer-'])).toEqual(['global'])
    expect(kinds('*{--univerx:0}', [], ['--univer-'])).toEqual(['global'])
    expect(kinds('*{--univer-a:0;--color-x:red}', [], ['--univer-'])).toEqual(['global', 'token'])
    expect(kinds('*{}', [], ['--univer-'])).toEqual(['global'])
  })

  it("still reads the rule's nested rules as loose", () => {
    expect(kinds('*{--univer-a:0;p{color:red}}', [], ['--univer-'])).toEqual(['global'])
    expect(kinds('*{--univer-a:0;.univer-x{color:red}}', [], ['--univer-'])).toEqual([])
  })

  it("refuses a namespace that overlaps the desktop's", () => {
    for (const namespace of [
      '--color-',
      '--font-',
      '--text-',
      '--k-',
      '--tw-',
      '--tw-univer-',
      '--radius-',
    ]) {
      expect(kinds('.univer-x{color:red}', [], [namespace]), namespace).toEqual(['token'])
    }
    expect(checkVendorCss('', { isDesktopVariable, ownCustomProperties: ['--tw-'] })).toEqual([
      {
        kind: 'token',
        detail: `ownCustomProperties "--tw-" overlaps the desktop's custom properties`,
      },
    ])
    // And the overlapping namespace allows nothing.
    expect(kinds('*{--tw-x:0}', [], ['--tw-'])).toEqual(['token', 'global'])
  })

  it('refuses what is not a namespace', () => {
    for (const namespace of ['--', '--t', '--univer', 'univer-', '--Univer-', '--univer--']) {
      expect(kinds('', [], [namespace]), namespace).toEqual(['unsupported'])
    }
  })

  it("passes Univer 0.25.1's sheet with one declared drop", () => {
    const source = readFileSync(univerCss)
    const dropped = '*{scrollbar-color:initial;scrollbar-width:initial}'
    const options = { isDesktopVariable, ownCustomProperties: ['--univer-'] }
    expect(checkVendorCss(dropVendorRules(source, [dropped]).toString('utf8'), options)).toEqual([])
    // The rule it drops: `initial` is `auto`, what the desktop has, but unlayered
    // it would beat any scrollbar styling the desktop adds in a layer.
    expect(checkVendorCss(source.toString('utf8'), options)).toEqual([
      {
        kind: 'global',
        detail: `"*" is not tied to the library's own elements (no class or id of its own), and scrollbar-color is not one of its own custom properties (--univer-*)`,
      },
    ])
  })
})

describe('dropVendorRules', () => {
  const sheet =
    '.é-a{content:"→"}\n*{scrollbar-width:initial}\n.b{x:1}@media (x){*{scrollbar-width:initial}}\n'
  const bytes = Buffer.from(sheet, 'utf8')

  it('cuts each named top-level rule and keeps every other byte', () => {
    const out = dropVendorRules(bytes, ['*{scrollbar-width:initial}'])
    expect(out.toString('utf8')).toBe(
      '.é-a{content:"→"}\n\n.b{x:1}@media (x){*{scrollbar-width:initial}}\n'
    )
    expect(dropVendorRules(bytes, ['.b{x:1}', '.é-a{content:"→"}']).toString('utf8')).toBe(
      '\n*{scrollbar-width:initial}\n@media (x){*{scrollbar-width:initial}}\n'
    )
    expect(dropVendorRules(bytes, [])).toBe(bytes)
  })

  it('refuses a rule that is not there exactly once, as written, at the top level', () => {
    // Not there: other whitespace, a longer selector, or only inside @media.
    for (const missing of ['* { scrollbar-width: initial }', '.b{x:2}', '{x:1}', '*{x:1}']) {
      expect(() => dropVendorRules(bytes, [missing]), missing).toThrow(
        /is in the sheet 0 times as a top-level rule, not once/
      )
    }
    const twice = Buffer.from('p{margin:0}.a{x:1}p{margin:0}')
    expect(() => dropVendorRules(twice, ['p{margin:0}'])).toThrow(
      /"p\{margin:0\}" is in the sheet 2 times as a top-level rule, not once/
    )
    expect(() => dropVendorRules(twice, ['.a{x:1}', '.a{x:1}'])).toThrow(/listed twice/)
  })

  it('refuses a sheet that is not UTF-8', () => {
    expect(() => dropVendorRules(Buffer.from([0x2e, 0x61, 0xff, 0x7b, 0x7d]), ['.a{}'])).toThrow(
      /not valid UTF-8/
    )
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
        ownCustomProperties: [],
        dropRules: [],
      },
    ])
    expect(readVendorStyles(join(repoRoot, 'apps', 'sheets'), 'sheets')).toEqual([
      {
        fileName: 'univer.css',
        specifier: '@univerjs/preset-sheets-core/lib/index.css',
        path: univerCss,
        ownAttributes: [],
        ownCustomProperties: ['--univer-'],
        dropRules: ['*{scrollbar-color:initial;scrollbar-width:initial}'],
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
        ownCustomProperties: [],
        dropRules: [],
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
    for (const ownCustomProperties of ['--lib-', ['--l'], ['lib-'], [3]]) {
      expect(() =>
        readVendorStyles(styles({ 'lib.css': { from: './a.css', ownCustomProperties } }), 'x')
      ).toThrow(/"ownCustomProperties" lists custom-property namespaces/)
    }
    for (const dropRules of ['p{}', [''], [' p{}'], [3], ['p{}', 'p{}']]) {
      expect(() =>
        readVendorStyles(styles({ 'lib.css': { from: './a.css', dropRules } }), 'x')
      ).toThrow(/"dropRules" lists the exact text of top-level rules/)
    }
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
