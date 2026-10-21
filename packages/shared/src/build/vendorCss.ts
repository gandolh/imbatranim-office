/**
 * Vendor stylesheets: a library's own CSS (SuperDoc's `style.css`, later
 * Univer's and pdf.js's), which an app cannot import from JS (the build refuses
 * that, see appCss.ts) and which is not Tailwind utilities.
 *
 * An app declares each one in its `package.json`:
 *
 *   "imbatranimOffice": {
 *     "vendorStyles": {
 *       "superdoc.css": {
 *         "from": "@harbour-enterprises/superdoc/style.css",
 *         "ownAttributes": ["data-tippy-root"]
 *       },
 *       "univer.css": {
 *         "from": "@univerjs/preset-sheets-core/lib/index.css",
 *         "ownCustomProperties": ["--univer-"],
 *         "dropRules": ["*{scrollbar-color:initial;scrollbar-width:initial}"]
 *       }
 *     }
 *   }
 *
 * The key is the file the build writes beside `app.css` (`dist/os/docs/superdoc.css`).
 * `from` is resolved from the app's directory like an import (a package export
 * or a relative path); a bare string is the same as `{ "from": … }`.
 * `ownAttributes` names attributes only the library's elements carry, which
 * then tie a rule to the library the way its classes do (see
 * {@link checkVendorCss}). `ownCustomProperties` names custom-property
 * namespaces only the library uses (`--univer-`): a rule on any element may
 * set those and nothing else. `dropRules` lists top-level rules, each by its
 * exact source text, that the build leaves out of the copy (see
 * {@link dropVendorRules}); the check reads what is left. The file is copied
 * byte for byte otherwise once it passes, and the descriptor lists it in the
 * app's `styles` after `app.css` (see `appStylePaths` in osBuild.ts).
 *
 * The desktop adds an app's styles to its own page and leaves them there, so
 * a vendor sheet is in force for every window, not just the app's. The check
 * is therefore about the desktop, not the vendor: a vendor rule may style the
 * vendor's own elements however it likes, and may not touch anything else.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  cssEscapeLength,
  cssUnescape,
  parseCss,
  parseCssTopLevel,
  type CssNode,
  type CssRuleProblem,
} from './cssRule.ts'

export type VendorStyle = {
  /** The file written beside `app.css`: `dist/os/<app>/<fileName>`. */
  fileName: string
  /** What the app's package.json names as `from`, for messages. */
  specifier: string
  /** The resolved stylesheet on disk. */
  path: string
  /** Attributes only the library's elements carry (`data-tippy-root`). */
  ownAttributes: string[]
  /** Custom-property namespaces only the library uses (`--univer-`). */
  ownCustomProperties: string[]
  /** Top-level rules, by exact source text, the build leaves out of the copy. */
  dropRules: string[]
}

const VENDOR_FILE = /^[a-z0-9][a-z0-9-]*\.css$/
const DATA_ATTRIBUTE = /^data-[a-z0-9-]+$/
/**
 * A custom-property namespace: whole lowercase segments and a closing dash
 * (`--univer-`, `--lib-ui-`). Never a bare stem like `--t`, which would reach
 * into `--tw-*` and `--text-*`.
 */
const CUSTOM_PROPERTY_NAMESPACE = /^--[a-z0-9]+(?:-[a-z0-9]+)*-$/
/** The OS allows 8 styles per app (OS brief 163); `app.css` is one of them. */
export const MAX_VENDOR_STYLES = 7

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Read and resolve `imbatranimOffice.vendorStyles` from `apps/<name>/package.json`. */
export function readVendorStyles(appDir: string, appName: string): VendorStyle[] {
  const pkgPath = join(appDir, 'package.json')
  if (!existsSync(pkgPath)) return []
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { imbatranimOffice?: unknown }
  const where = `apps/${appName}/package.json`
  const settings = pkg.imbatranimOffice
  if (settings === undefined) return []
  if (!isObject(settings)) throw new Error(`${where}: "imbatranimOffice" is an object`)
  const declared = settings.vendorStyles
  if (declared === undefined) return []
  if (!isObject(declared)) {
    throw new Error(
      `${where}: "imbatranimOffice.vendorStyles" maps a file name to a stylesheet, { "lib.css": { "from": "lib/style.css" } }`
    )
  }
  const entries = Object.entries(declared)
  if (entries.length > MAX_VENDOR_STYLES) {
    throw new Error(
      `${where}: at most ${MAX_VENDOR_STYLES} vendor stylesheets (the desktop takes 8 styles per app, app.css included)`
    )
  }
  const require = createRequire(pkgPath)
  return entries.map(([fileName, value]) => {
    const name = `${where}: vendor stylesheet "${fileName}"`
    if (!VENDOR_FILE.test(fileName) || fileName === 'app.css') {
      throw new Error(
        `${name} must be lowercase letters, digits and "-", end in .css, and not be app.css`
      )
    }
    const spec = typeof value === 'string' ? { from: value } : value
    if (!isObject(spec) || typeof spec.from !== 'string' || spec.from === '') {
      throw new Error(`${name} names no stylesheet: give "from"`)
    }
    const own = spec.ownAttributes ?? []
    if (
      !Array.isArray(own) ||
      !own.every((a): a is string => typeof a === 'string' && DATA_ATTRIBUTE.test(a))
    ) {
      throw new Error(`${name}: "ownAttributes" lists data-* attribute names`)
    }
    const ownVariables = spec.ownCustomProperties ?? []
    if (
      !Array.isArray(ownVariables) ||
      !ownVariables.every(
        (p): p is string => typeof p === 'string' && CUSTOM_PROPERTY_NAMESPACE.test(p)
      )
    ) {
      throw new Error(
        `${name}: "ownCustomProperties" lists custom-property namespaces, lowercase and ending in "-" ("--lib-")`
      )
    }
    const drop = spec.dropRules ?? []
    if (
      !Array.isArray(drop) ||
      !drop.every((r): r is string => typeof r === 'string' && r.trim() === r && r !== '') ||
      new Set(drop).size !== drop.length
    ) {
      throw new Error(
        `${name}: "dropRules" lists the exact text of top-level rules, each once and without surrounding whitespace`
      )
    }
    let path: string
    try {
      path = require.resolve(spec.from)
    } catch {
      throw new Error(
        `${name}: cannot resolve "${spec.from}" from apps/${appName} (is its package a dependency?)`
      )
    }
    if (!path.endsWith('.css')) throw new Error(`${name}: "${spec.from}" is not a .css file`)
    return {
      fileName,
      specifier: spec.from,
      path,
      ownAttributes: [...own],
      ownCustomProperties: [...ownVariables],
      dropRules: [...drop],
    }
  })
}

/**
 * The custom properties the desktop owns, as a test on a name. `sheets` are
 * the stylesheets the desktop's theme is made of: Tailwind's `theme.css` and
 * the kit's token file. A name is the desktop's when one of them defines or
 * reads it (`--spacing`, `--k-surface`, `--accent`) or when it falls in a
 * namespace they define (`--font-*`, `--text-*`, `--radius-*`, `--k-*`):
 * Tailwind emits whichever of those the desktop uses on `:root`, so a vendor
 * sheet setting one there would restyle every window. `--color-*` and
 * `--tw-*` always are.
 */
export function desktopVariables(sheets: readonly string[]): (name: string) => boolean {
  const names = new Set<string>()
  const namespaces = new Set<string>(['--color-', '--tw-'])
  for (const sheet of sheets) {
    for (const name of sheet.replace(/\/\*[\s\S]*?\*\//g, '').match(/--[\w-]+/g) ?? []) {
      names.add(name)
      const space = /^--[a-zA-Z0-9]+-/.exec(name)
      if (space) namespaces.add(space[0])
    }
  }
  return (name) => names.has(name) || [...namespaces].some((ns) => name.startsWith(ns))
}

/**
 * `source` without the top-level rules `dropRules` names, every other byte as
 * it was. A rule is named by its exact source text, from its first character to
 * its closing brace (`*{scrollbar-color:initial;scrollbar-width:initial}`): no
 * normalising, so a library release that touches the rule at all no longer
 * matches. Throws unless each one is in the sheet exactly once as a top-level
 * rule (the same text inside `@media` or a longer selector does not count): a
 * drop that stops matching, or starts matching twice, needs a person to look
 * at the sheet again rather than a build that passes on its own.
 */
export function dropVendorRules(source: Buffer, dropRules: readonly string[]): Buffer {
  if (dropRules.length === 0) return source
  const css = source.toString('utf8')
  if (!Buffer.from(css, 'utf8').equals(source)) {
    throw new Error('dropRules: the stylesheet is not valid UTF-8, so no rule can be cut from it')
  }
  const top = parseCssTopLevel(css)
  const cuts: { start: number; end: number }[] = []
  const wrong: string[] = []
  for (const [k, rule] of dropRules.entries()) {
    const found = top.filter((t) => css.slice(t.start, t.end) === rule)
    if (dropRules.indexOf(rule) !== k) wrong.push(`"${rule}" is listed twice`)
    else if (found.length === 1) cuts.push(found[0])
    else wrong.push(`"${rule}" is in the sheet ${found.length} times as a top-level rule, not once`)
  }
  if (wrong.length > 0) {
    throw new Error(
      ['dropRules do not match the sheet:', ...wrong.map((w) => `  - ${w}`)].join('\n')
    )
  }
  const bytesTo = (index: number) => Buffer.byteLength(css.slice(0, index), 'utf8')
  const kept: Buffer[] = []
  let at = 0
  for (const cut of cuts.sort((a, b) => a.start - b.start)) {
    kept.push(source.subarray(at, bytesTo(cut.start)))
    at = bytesTo(cut.end)
  }
  kept.push(source.subarray(at))
  return Buffer.concat(kept)
}

// ── Selector analysis ────────────────────────────────────────────────────────

/** Split `text` where `isBreak` holds outside (), [] and strings. Empty parts dropped. */
function splitTopLevel(text: string, isBreak: (ch: string) => boolean): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i += cssEscapeLength(text, i) - 1
    } else if (ch === '"' || ch === "'") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++
    } else if (ch === '(' || ch === '[') {
      depth++
    } else if (ch === ')' || ch === ']') {
      depth--
    } else if (depth === 0 && isBreak(ch)) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

const selectorList = (selector: string) => splitTopLevel(selector, (ch) => ch === ',')
const compoundsOf = (complex: string) => splitTopLevel(complex, (ch) => /[\s>+~]/.test(ch))

/**
 * `selector` with every escape replaced by `_`, an ordinary name character. An
 * escape is always part of a name, so `.before\:x:before` is the class
 * `before_x` and then `:before`, `.w-1\/2` and `.\[\&_p\]` are one class each,
 * and `x\.y` is a type selector, not `x` with a class. The analysis below runs
 * on this escape-free text.
 */
function neutral(selector: string): string {
  let out = ''
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '\\') {
      out += '_'
      i += cssEscapeLength(selector, i) - 1
    } else {
      out += selector[i]
    }
  }
  return out
}

/** Pseudo-classes whose argument narrows the compound to what it matches. */
const NARROWING = new Set(['is', 'where', 'matches', '-webkit-any', '-moz-any'])

type Selectors = {
  /** True when some compound ties the element, or an ancestor, to the library. */
  anchored(complex: string): boolean
  /** True when the subject is the document itself: `html`, `body`, `:root`, `:host`. */
  isRoot(complex: string): boolean
}

function selectorAnalysis(ownAttributes: readonly string[]): Selectors {
  const own = new Set(ownAttributes)

  /**
   * Replace each functional pseudo-class in `compound` by what it contributes:
   * `:is()`/`:where()` count as a class when every alternative is anchored,
   * and every other argument (`:not()`, `:has()`, `:nth-child()`) as nothing,
   * because it does not tie the element itself to the library. Strings go.
   * `compound` is escape-free (see {@link neutral}).
   */
  const flatten = (compound: string): string => {
    let out = ''
    for (let i = 0; i < compound.length; i++) {
      const ch = compound[i]
      if (ch === '"' || ch === "'") {
        const close = compound.indexOf(ch, i + 1)
        i = close < 0 ? compound.length : close
      } else if (ch === '(') {
        let depth = 1
        let j = i + 1
        for (; j < compound.length && depth > 0; j++) {
          if (compound[j] === '(') depth++
          else if (compound[j] === ')') depth--
        }
        const pseudo = /:([\w-]+)$/.exec(out)
        if (pseudo) out = out.slice(0, pseudo.index)
        const name = pseudo?.[1].toLowerCase() ?? ''
        if (NARROWING.has(name) && selectorList(compound.slice(i + 1, j - 1)).every(anchored)) {
          out += '.anchored'
        }
        i = j - 1
      } else {
        out += ch
      }
    }
    return out
  }

  const isRootCompound = (compound: string): boolean => {
    const flat = flatten(compound)
    return /^(?:html|body)(?![\w-])/i.test(flat) || /:(?:root|host)(?![\w-])/i.test(flat)
  }

  /**
   * A compound ties an element to the library when it carries a class, an id,
   * Vue's scoped-style attribute (`[data-v-1a2b3c4d]`, which only that
   * component's elements have) or one of the declared `ownAttributes`. A class
   * on the root does not count: it is the desktop's. Other attributes do not
   * count either (`[hidden]`, `[data-state]`, `[data-theme=dark]`): desktop
   * elements carry those too.
   */
  const compoundAnchors = (compound: string): boolean => {
    if (isRootCompound(compound)) return false
    const flat = flatten(compound)
    if (/[.#](?:[-_a-zA-Z]|[^\p{ASCII}])/u.test(flat)) return true
    for (const m of flat.matchAll(/\[\s*([\w-]+)/g)) {
      if (m[1].startsWith('data-v-') || own.has(m[1])) return true
    }
    return false
  }

  function anchored(complex: string): boolean {
    return compoundsOf(neutral(complex).replace(/&/g, ' ')).some(compoundAnchors)
  }

  return {
    anchored,
    isRoot(complex) {
      const parts = compoundsOf(neutral(complex))
      return parts.length > 0 && isRootCompound(parts[parts.length - 1])
    },
  }
}

// ── The check ────────────────────────────────────────────────────────────────

/**
 * Every way a vendor stylesheet would reach outside the library's own
 * elements; empty when it does not. Allowed:
 *
 * - style rules anchored to the library (a class, an id, `[data-v-…]` or a
 *   declared own attribute in some compound), inside `@media`, `@supports`,
 *   `@container` and `@layer` as deep as they go;
 * - custom properties on `:root`, so the library's popups, which it mounts in
 *   `<body>` outside the window, still read its variables; but none the
 *   desktop owns (see {@link desktopVariables}), and no other
 *   declaration there;
 * - a rule on any element (`*, :before, :after, ::backdrop`, Tailwind's
 *   initialiser of its variables) that sets nothing but custom properties in
 *   the declared `ownCustomProperties` namespaces: a variable only the library
 *   reads changes no desktop style. A namespace that overlaps the desktop's
 *   (`--tw-`, `--font-`, `--k-`, …) is refused;
 * - `@keyframes`, `@property` (not a desktop name), `@charset`, `@layer a, b;`.
 *
 * Refused: a rule that reaches an element by type or by a common attribute
 * alone (`p`, `*`, `img:hover`, `::selection`, `[hidden]`) or that styles
 * `html`/`body` (`body.dark p` included: that class is the desktop's), unless
 * it sets only the library's own custom properties; a `--color-*` definition
 * anywhere; `@import`, `@font-face` and any `url()` that is not `data:`,
 * because the build copies the sheet and nothing it points at; and any other
 * at-rule. Selectors and property names are read with their escapes
 * (`.before\:x`, `--a\2d b`) as CSS reads them.
 */
export function checkVendorCss(
  css: string,
  options: {
    isDesktopVariable: (name: string) => boolean
    ownAttributes?: readonly string[]
    ownCustomProperties?: readonly string[]
  }
): CssRuleProblem[] {
  const problems: CssRuleProblem[] = []
  const selectors = selectorAnalysis(options.ownAttributes ?? [])
  const owned = options.isDesktopVariable

  // A namespace is whole segments and a dash, and the desktop's namespaces are
  // one segment each (`--tw-`, `--k-`), so a declared namespace overlaps one of
  // them, or a name the desktop uses, exactly when it is a desktop name itself.
  const ownNamespaces: string[] = []
  for (const namespace of options.ownCustomProperties ?? []) {
    if (!CUSTOM_PROPERTY_NAMESPACE.test(namespace)) {
      problems.push({
        kind: 'unsupported',
        detail: `ownCustomProperties "${namespace}" is not a namespace like "--lib-"`,
      })
    } else if (owned(namespace)) {
      problems.push({
        kind: 'token',
        detail: `ownCustomProperties "${namespace}" overlaps the desktop's custom properties`,
      })
    } else {
      ownNamespaces.push(namespace)
    }
  }
  const isOwnVariable = (property: string) => {
    const name = cssUnescape(property)
    return ownNamespaces.some((ns) => name.startsWith(ns)) && !owned(name)
  }

  const checkDeclarations = (
    nodes: CssNode[],
    where: { rootSelector: string | null; selector: string }
  ) => {
    for (const node of nodes) {
      if (node.type !== 'decl') continue
      const property = cssUnescape(node.property)
      if (/^--color-/.test(property)) {
        problems.push({ kind: 'token', detail: `defines the token ${property}` })
      } else if (where.rootSelector !== null) {
        if (!property.startsWith('--')) {
          problems.push({
            kind: 'global',
            detail: `"${where.rootSelector}" sets ${property} on the desktop's document`,
          })
        } else if (owned(property)) {
          problems.push({
            kind: 'token',
            detail: `"${where.rootSelector}" sets the desktop's ${property}`,
          })
        }
      }
      // A quoted URL may hold the other quote (SuperDoc's inline SVGs do).
      for (const m of node.value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]*))\s*\)/gi)) {
        const url = (m[1] ?? m[2] ?? m[3]).trim()
        if (!/^data:/i.test(url)) {
          problems.push({
            kind: 'external',
            detail: `"${where.selector}" loads ${url || '(an empty url)'}, which the build does not copy`,
          })
        }
      }
    }
  }

  const visit = (nodes: CssNode[], parentAnchored: boolean) => {
    for (const node of nodes) {
      if (node.type === 'decl') {
        // Only an at-rule nested in an anchored rule holds declarations of its own.
        if (parentAnchored) checkDeclarations([node], { rootSelector: null, selector: '(nested)' })
        else
          problems.push({
            kind: 'unsupported',
            detail: `a declaration outside any rule: ${node.property}`,
          })
        continue
      }
      if (node.type === 'rule') {
        const parts = selectorList(node.selector)
        const rootParts = parentAnchored ? [] : parts.filter((p) => selectors.isRoot(p))
        const loose = parentAnchored
          ? []
          : parts.filter((p) => !selectors.isRoot(p) && !selectors.anchored(p))
        // A loose rule may stand when all it sets is the library's own variables.
        // Its nested rules are still read as loose (see the visit below).
        const declarations = node.children.filter((c) => c.type === 'decl')
        const notOwn = declarations.find((d) => !isOwnVariable(d.property))
        const ownVariablesOnly =
          ownNamespaces.length > 0 && declarations.length > 0 && notOwn === undefined
        for (const part of ownVariablesOnly ? [] : loose) {
          const why =
            ownNamespaces.length > 0 && notOwn
              ? `, and ${cssUnescape(notOwn.property)} is not one of its own custom properties (${ownNamespaces.map((ns) => `${ns}*`).join(', ')})`
              : ''
          problems.push({
            kind: 'global',
            detail: `"${part}" is not tied to the library's own elements (no class or id of its own)${why}`,
          })
        }
        checkDeclarations(node.children, {
          rootSelector: rootParts.length > 0 ? rootParts.join(', ') : null,
          selector: node.selector,
        })
        visit(
          node.children.filter((c) => c.type !== 'decl'),
          parentAnchored || (rootParts.length === 0 && loose.length === 0)
        )
        continue
      }
      switch (node.name) {
        case 'media':
        case 'supports':
        case 'container':
          visit(node.children ?? [], parentAnchored)
          continue
        case 'layer':
          if (node.children) visit(node.children, parentAnchored)
          continue
        case 'keyframes':
        case '-webkit-keyframes':
        case 'charset':
          continue
        case 'property':
          if (owned(cssUnescape(node.prelude))) {
            problems.push({ kind: 'token', detail: `@property ${node.prelude} is the desktop's` })
          }
          continue
        case 'import':
          problems.push({
            kind: 'external',
            detail: `@import ${node.prelude}: another stylesheet, which the build does not copy or check`,
          })
          continue
        case 'font-face':
          problems.push({
            kind: 'external',
            detail:
              "@font-face: the build copies no font files, and a family could shadow the desktop's",
          })
          continue
        default:
          problems.push({ kind: 'unsupported', detail: `@${node.name} ${node.prelude}`.trim() })
      }
    }
  }

  visit(parseCss(css), false)
  return problems
}

export function describeVendorProblems(
  file: string,
  specifier: string,
  problems: CssRuleProblem[]
): string {
  return [
    `${file} (${specifier}) would restyle the desktop outside the window:`,
    ...problems.map((p) => `  - ${p.kind}: ${p.detail}`),
  ].join('\n')
}
