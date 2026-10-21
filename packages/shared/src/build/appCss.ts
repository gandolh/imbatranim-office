/**
 * Each app's stylesheet: Tailwind utilities for the classes that app's own
 * source uses, compiled against the kit snapshot's token names, with no
 * preflight and no theme of its own (OS brief 163, decision 5).
 *
 * Both themes are imported with `theme(reference)`: Tailwind knows every token
 * name and default (so `bg-primary`, `px-3` and `text-sm` compile) but emits
 * none of them. A utility then reads the desktop's variable with the
 * snapshot's value as its fallback, `background-color: var(--color-primary,
 * var(--accent))`, so it follows the desktop (accent, light/dark) and still
 * works for a token the desktop's own CSS never used and so never emitted.
 *
 * Kit classes are not scanned: the desktop compiles `packages/ui` into its own
 * CSS, so the kit's buttons and dialogs are styled before any app sheet loads.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { compile, optimize } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import type { Plugin } from 'vite'
import { checkUtilitiesOnly, type CssRuleProblem } from './cssRule.ts'
import {
  checkVendorCss,
  describeVendorProblems,
  desktopVariables,
  dropVendorRules,
  type VendorStyle,
} from './vendorCss.ts'

export type AppCssInput = {
  /** The app's directory, `apps/<name>`; relative paths in its CSS resolve from here. */
  appDir: string
  /** Directories whose files are scanned for class names. */
  sources: readonly string[]
  /** Directories inside those that are not (build code, test helpers). */
  excludes?: readonly string[]
  /** The kit snapshot's token file. */
  themeCss: string
  /** Extra Tailwind CSS the app keeps in `src/app.css` (an `@utility`, a `@source`). Checked like the rest. */
  extra?: string
}

function cssPath(from: string, to: string): string {
  const rel = relative(from, to).split(sep).join('/')
  return JSON.stringify(rel.startsWith('.') ? rel : `./${rel}`)
}

/** The stylesheet Tailwind compiles for one app. */
export function appCssSource(input: AppCssInput): string {
  const base = input.appDir
  const lines = [
    "@import 'tailwindcss/theme.css' theme(reference);",
    `@import ${cssPath(base, input.themeCss)} theme(reference);`,
    "@import 'tailwindcss/utilities.css' layer(utilities) source(none);",
    ...input.sources.flatMap((dir) => [
      `@source ${cssPath(base, dir)};`,
      `@source not ${cssPath(base, join(dir, '**/*.test.{ts,tsx}'))};`,
    ]),
    ...(input.excludes ?? []).map((dir) => `@source not ${cssPath(base, dir)};`),
  ]
  if (input.extra) lines.push(input.extra)
  return `${lines.join('\n')}\n`
}

/** Compile one app's stylesheet, minified. */
export async function compileAppCss(input: AppCssInput): Promise<string> {
  const base = input.appDir
  const compiler = await compile(appCssSource(input), { base, onDependency: () => {} })
  // The same source list Tailwind's own CLI builds from a compiled stylesheet.
  const sources = (
    compiler.root === 'none'
      ? []
      : compiler.root === null
        ? [{ base, pattern: '**/*' }]
        : [compiler.root]
  )
    .map((s) => ({ ...s, negated: false }))
    .concat(compiler.sources)
  const candidates = new Scanner({ sources }).scan()
  return optimize(compiler.build(candidates), { file: 'app.css', minify: true }).code
}

export function describeProblems(file: string, problems: CssRuleProblem[]): string {
  return [
    `${file} breaks the CSS rule (Tailwind utilities only: no preflight, no tokens of its own):`,
    ...problems.map((p) => `  - ${p.kind}: ${p.detail}`),
  ].join('\n')
}

export type StyledApp = {
  name: string
  dir: string
  /** The library stylesheets the app declares (vendorCss.ts), copied beside app.css. */
  vendorStyles?: readonly VendorStyle[]
}

/**
 * Emit `<app>/app.css` for every app, and fail the build if one breaks the CSS
 * rule or if any other stylesheet is emitted (CSS imported from JS would reach
 * the page without the check). Then copy each declared vendor stylesheet to
 * `<app>/<file>`, failing the build if it would restyle the desktop outside the
 * window (`checkVendorCss`).
 */
export function appStyles(options: {
  apps: readonly StyledApp[]
  themeCss: string
  /** Shared source directories scanned for every app, beside the app's own `src`. */
  sharedSources?: readonly string[]
  sharedExcludes?: readonly string[]
}): Plugin {
  return {
    name: 'imbatranim-office:app-styles',
    // After Vite's own CSS plugin, which emits imported CSS in its generateBundle.
    enforce: 'post',
    async generateBundle(_output, bundle) {
      // What the desktop's theme is made of: Tailwind's (resolved as the app
      // stylesheets resolve it) and the kit's tokens.
      const isDesktopVariable = desktopVariables([
        readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8'),
        readFileSync(options.themeCss, 'utf8'),
      ])
      for (const file of Object.values(bundle)) {
        if (file.fileName.endsWith('.css')) {
          this.error(
            `${file.fileName}: CSS imported from JS is not part of the build. An app's styles are its app.css, Tailwind utilities only.`
          )
        }
      }
      for (const app of options.apps) {
        const extraFile = join(app.dir, 'src', 'app.css')
        const sources = [
          join(app.dir, 'src'),
          ...(options.sharedSources ?? []).filter((d) => existsSync(d)),
        ]
        const css = await compileAppCss({
          appDir: existsSync(extraFile) ? dirname(extraFile) : app.dir,
          sources,
          excludes: options.sharedExcludes,
          themeCss: options.themeCss,
          extra: existsSync(extraFile) ? readFileSync(extraFile, 'utf8') : undefined,
        })
        const fileName = `${app.name}/app.css`
        const problems = checkUtilitiesOnly(css)
        if (problems.length > 0) this.error(describeProblems(fileName, problems))
        this.emitFile({ type: 'asset', fileName, source: css })

        for (const vendor of app.vendorStyles ?? []) {
          const vendorFile = `${app.name}/${vendor.fileName}`
          // Copied as it is, byte for byte, but for the rules it declares dropped.
          let vendorCss: Buffer
          try {
            vendorCss = dropVendorRules(readFileSync(vendor.path), vendor.dropRules)
          } catch (err) {
            this.error(`${vendorFile} (${vendor.specifier}): ${(err as Error).message}`)
          }
          const vendorProblems = checkVendorCss(vendorCss.toString('utf8'), {
            isDesktopVariable,
            ownAttributes: vendor.ownAttributes,
            ownCustomProperties: vendor.ownCustomProperties,
          })
          if (vendorProblems.length > 0) {
            this.error(describeVendorProblems(vendorFile, vendor.specifier, vendorProblems))
          }
          this.emitFile({ type: 'asset', fileName: vendorFile, source: vendorCss })
        }
      }
    },
  }
}
