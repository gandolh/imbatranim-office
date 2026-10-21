import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile, optimize } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileAppCss } from './appCss.ts'
import { checkUtilitiesOnly, cssUnescape, parseCss, parseCssTopLevel } from './cssRule.ts'
import { readKitSnapshot } from './kitSnapshot.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const theme = readKitSnapshot(join(repoRoot, 'vendor', 'imbatranim-ui')).themeCss

// Tailwind resolves `tailwindcss/*` from the stylesheet's base, so the scratch
// app lives inside the repo (node_modules/.tmp is ignored by git and the linters).
let app: string

beforeAll(() => {
  mkdirSync(join(repoRoot, 'node_modules', '.tmp'), { recursive: true })
  app = mkdtempSync(join(repoRoot, 'node_modules', '.tmp', 'css-rule-'))
  mkdirSync(join(app, 'src'))
  writeFileSync(
    join(app, 'src', 'App.tsx'),
    'export const App = () => <div className="bg-primary text-on-surface ring-2 hover:bg-error px-3 text-sm shadow-md animate-spin" />\n'
  )
})

afterAll(() => rmSync(app, { recursive: true, force: true }))

/** Compile any Tailwind input over the scratch app's source, as Tailwind's CLI would. */
async function tailwind(css: string, minify = true): Promise<string> {
  const compiler = await compile(css, { base: app, onDependency: () => {} })
  const sources = (compiler.root === 'none' ? [] : [{ base: join(app, 'src'), pattern: '**/*' }])
    .map((s) => ({ ...s, negated: false }))
    .concat(compiler.sources)
  return optimize(compiler.build(new Scanner({ sources }).scan()), { minify }).code
}

describe('the CSS rule', () => {
  it("passes the app pipeline's own output, which reads the desktop's variables", async () => {
    const css = await compileAppCss({ appDir: app, sources: [join(app, 'src')], themeCss: theme })
    expect(checkUtilitiesOnly(css)).toEqual([])
    // Utilities read the desktop's token, with the snapshot's value as fallback.
    expect(css).toContain('background-color:var(--color-primary,var(--accent))')
    expect(css).toContain('@layer utilities')
    // Tailwind's own --tw-* initialisers (universal selector, but not preflight) are allowed.
    expect(css).toMatch(/@layer properties/)
    expect(css).toMatch(/@property --tw-/)
    expect(css).toContain('@keyframes spin')
  })

  it('fails full Tailwind: preflight and token values', async () => {
    const css = await tailwind(`@import 'tailwindcss';\n@import ${JSON.stringify(theme)};`)
    const kinds = new Set(checkUtilitiesOnly(css).map((p) => p.kind))
    expect(kinds).toContain('preflight')
    expect(kinds).toContain('token')
  })

  it('fails preflight alone', async () => {
    const css = await tailwind(
      "@import 'tailwindcss/preflight.css' layer(base);\n@import 'tailwindcss/utilities.css' layer(utilities);"
    )
    expect(checkUtilitiesOnly(css)).toContainEqual({
      kind: 'preflight',
      detail: '@layer base (preflight lives there)',
    })
  })

  it('fails an app theme that defines a --color-* token', async () => {
    const css = await tailwind(
      "@import 'tailwindcss/utilities.css' layer(utilities);\n@theme { --color-primary: #ff0000; }",
      false
    )
    const problems = checkUtilitiesOnly(css)
    expect(problems).toContainEqual({ kind: 'token', detail: 'defines the token --color-primary' })
  })

  it('fails hand-written rules outside the utilities layer', () => {
    expect(checkUtilitiesOnly(':root{--color-accent:red}')).toEqual([
      { kind: 'token', detail: 'defines the token --color-accent' },
      { kind: 'preflight', detail: 'an unlayered rule ":root" (a preflight/base rule)' },
    ])
    expect(
      checkUtilitiesOnly('*,::before{box-sizing:border-box;margin:0}').map((p) => p.kind)
    ).toEqual(['preflight'])
    expect(checkUtilitiesOnly('.mine{color:red}').map((p) => p.kind)).toEqual(['not-utilities'])
    expect(checkUtilitiesOnly('@layer components{.btn{color:red}}').map((p) => p.kind)).toEqual([
      'not-utilities',
    ])
    expect(
      checkUtilitiesOnly("@font-face{font-family:x;src:url('x.woff2')}").map((p) => p.kind)
    ).toEqual(['not-utilities'])
    expect(checkUtilitiesOnly('@layer properties{*{--not-tw:1}}').map((p) => p.kind)).toEqual([
      'not-utilities',
    ])
  })

  it('reads a var(--color-*) use as a use, not a definition', () => {
    expect(checkUtilitiesOnly('@layer utilities{.x{color:var(--color-primary,red)}}')).toEqual([])
    expect(
      checkUtilitiesOnly(
        '@layer theme, base, utilities;@media (hover:hover){@layer utilities{.a:hover{color:red}}}'
      )
    ).toEqual([])
  })

  it('parses strings, comments and nesting', () => {
    const nodes = parseCss(
      '/* a { b } */ @layer utilities { .a\\:b { content: "}{;"; &:hover { color: red } } }'
    )
    expect(nodes).toEqual([
      {
        type: 'at',
        name: 'layer',
        prelude: 'utilities',
        children: [
          {
            type: 'rule',
            selector: '.a\\:b',
            children: [
              { type: 'decl', property: 'content', value: '"}{;"' },
              {
                type: 'rule',
                selector: '&:hover',
                children: [{ type: 'decl', property: 'color', value: 'red' }],
              },
            ],
          },
        ],
      },
    ])
  })

  it('reads escapes as characters of a name, not as syntax', () => {
    const rule = (selector: string, property: string, value: string) => ({
      type: 'rule',
      selector,
      children: [{ type: 'decl', property, value }],
    })
    // An escaped quote opens no string (Univer's `content-[""]` variant).
    expect(
      parseCss('.before\\:u-content-\\[\\"\\"\\]:before{content:""}.w-1\\/2{width:50%}')
    ).toEqual([
      rule('.before\\:u-content-\\[\\"\\"\\]:before', 'content', '""'),
      rule('.w-1\\/2', 'width', '50%'),
    ])
    // Nor do an escaped brace, semicolon or parenthesis end or group anything.
    expect(parseCss('.a\\{b\\;c\\(d{x:1}')).toEqual([rule('.a\\{b\\;c\\(d', 'x', '1')])
    // A hex escape keeps the space after it.
    expect(parseCss('.\\31 23{x:1}')).toEqual([rule('.\\31 23', 'x', '1')])
    // The property ends at the first colon that is not escaped.
    expect(parseCss('.x{--a\\:b:1}')).toEqual([rule('.x', '--a\\:b', '1')])
    expect(checkUtilitiesOnly("@layer utilities{.content-\\[\\'\\'\\]{content:''}}")).toEqual([])
  })

  it('gives each top-level node the source text it was read from', () => {
    const css = '/* c */ @layer a, b;\n.x\\:y { a: 1 }  @media (x) { p { b: 2 } } --z: 3'
    expect(parseCssTopLevel(css).map((t) => css.slice(t.start, t.end))).toEqual([
      '@layer a, b;',
      '.x\\:y { a: 1 }',
      '@media (x) { p { b: 2 } }',
      '--z: 3',
    ])
  })

  it('decodes escapes', () => {
    expect(cssUnescape('--colo\\72-x')).toBe('--color-x')
    expect(cssUnescape('before\\:x\\/2')).toBe('before:x/2')
    expect(cssUnescape('\\31 23')).toBe('123')
    expect(cssUnescape('\\0 a')).toBe('\ufffda')
  })
})
