/**
 * The CSS rule (OS brief 163, decision 5): an app's stylesheet is Tailwind
 * utilities and nothing else. The desktop already ships preflight and owns the
 * tokens; a second preflight would reset the desktop's own elements, and a
 * token defined here would override the desktop's (and its accent) for every
 * window once the sheet is added.
 *
 * This reads compiled CSS structurally. At the top level it allows only what
 * a utilities-only Tailwind build emits:
 *
 * - `@layer utilities { … }`;
 * - `@layer properties { … }`, Tailwind's fallback that initialises its own
 *   `--tw-*` variables on `*, :before, :after, ::backdrop` (not preflight);
 * - `@property --tw-*`, `@keyframes`, and bare `@layer a, b;` order statements;
 * - `@media` / `@supports` / `@container` whose contents follow the same rules.
 *
 * Anywhere at all, a declaration of a `--color-*` custom property is a token
 * definition and fails.
 */

export type CssRuleProblem = {
  /**
   * `preflight`, `token` and `not-utilities` come from {@link checkUtilitiesOnly};
   * `global`, `external` and `unsupported` from the vendor rule (vendorCss.ts),
   * which reports `token` too.
   */
  kind: 'preflight' | 'token' | 'not-utilities' | 'global' | 'external' | 'unsupported'
  detail: string
}

export type CssNode =
  | { type: 'at'; name: string; prelude: string; children: CssNode[] | null }
  | { type: 'rule'; selector: string; children: CssNode[] }
  | { type: 'decl'; property: string; value: string }

const ESCAPE = /\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[ \t\n\r\f])?|[\s\S])?/y
const ESCAPES = /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|([\s\S]))/g

/**
 * The length of the CSS escape that starts at `text[i]`, a backslash: `\` and
 * up to six hex digits plus one optional whitespace (`\31 `, `\2e`), or `\`
 * and any one other character (`\:`, `\/`, `\[`, `\"`). The escaped character
 * belongs to the name it sits in and is never syntax: `.before\:x:before` is
 * the class `before:x`, then the pseudo-element. Tailwind's class names are
 * full of these.
 */
export function cssEscapeLength(text: string, i: number): number {
  ESCAPE.lastIndex = i
  return ESCAPE.exec(text)?.[0].length ?? 1
}

/** `text` with its CSS escapes decoded: `--colo\72-x` is `--color-x`. */
export function cssUnescape(text: string): string {
  return text.replace(ESCAPES, (_match, hex: string | undefined, ch: string | undefined) => {
    if (hex === undefined) return ch ?? ''
    const code = parseInt(hex, 16)
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
      ? '\uFFFD'
      : String.fromCodePoint(code)
  })
}

/** Parse well-formed CSS into at-rules, style rules and declarations (nesting allowed). */
export function parseCss(css: string): CssNode[] {
  return parseCssTopLevel(css).map((t) => t.node)
}

/**
 * {@link parseCss}'s top-level nodes, each with the source text it was read
 * from: `css.slice(start, end)` is the rule from its first character to its
 * closing `}` (or `;`), without the whitespace and comments around it.
 */
export function parseCssTopLevel(css: string): { node: CssNode; start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  const nodes = parseNodes(css, spans)
  return nodes.map((node, k) => ({ node, ...spans[k] }))
}

function parseNodes(css: string, topSpans: { start: number; end: number }[]): CssNode[] {
  let i = 0
  const n = css.length

  const skipComment = () => {
    const close = css.indexOf('*/', i + 2)
    i = close < 0 ? n : close + 2
  }
  const skipString = (quote: string) => {
    i++
    while (i < n && css[i] !== quote) i += css[i] === '\\' ? 2 : 1
    i++
  }

  /**
   * Read up to (not including) the first `{`, `;` or `}` outside strings,
   * comments, parentheses and escapes (an escaped `\"`, `\(` or `\{` is a
   * character of a name, not the start of a string, a group or a block).
   */
  const readPrelude = (): { text: string; stop: string } => {
    let text = ''
    let parens = 0
    while (i < n) {
      if (css.startsWith('/*', i)) {
        skipComment()
        continue
      }
      const ch = css[i]
      if (ch === '\\') {
        const length = cssEscapeLength(css, i)
        text += css.slice(i, i + length)
        i += length
        continue
      }
      if (ch === '"' || ch === "'") {
        const start = i
        skipString(ch)
        text += css.slice(start, i)
        continue
      }
      if (ch === '(') parens++
      if (ch === ')') parens--
      if (parens === 0 && (ch === '{' || ch === ';' || ch === '}'))
        return { text: text.trim(), stop: ch }
      text += ch
      i++
    }
    return { text: text.trim(), stop: '' }
  }

  /** `spans`, given at the top level only, gets each node's source range. */
  const parseBlock = (spans?: { start: number; end: number }[]): CssNode[] => {
    const nodes: CssNode[] = []
    const push = (node: CssNode, start: number) => {
      nodes.push(node)
      spans?.push({ start, end: i })
    }
    for (;;) {
      while (i < n && /\s/.test(css[i])) i++
      if (css.startsWith('/*', i)) {
        skipComment()
        continue
      }
      if (i >= n) return nodes
      if (css[i] === '}') {
        i++
        return nodes
      }
      const start = i
      const { text, stop } = readPrelude()
      if (stop === '{') {
        i++
        const children = parseBlock()
        if (text.startsWith('@')) {
          const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(text)
          push(
            {
              type: 'at',
              name: (m?.[1] ?? '').toLowerCase(),
              prelude: (m?.[2] ?? '').trim(),
              children,
            },
            start
          )
        } else {
          push({ type: 'rule', selector: text, children }, start)
        }
        continue
      }
      if (stop === ';') i++
      if (text === '') continue
      if (text.startsWith('@')) {
        const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(text)
        push(
          {
            type: 'at',
            name: (m?.[1] ?? '').toLowerCase(),
            prelude: (m?.[2] ?? '').trim(),
            children: null,
          },
          start
        )
      } else {
        // The first colon that is not escaped (`--a\:b: 1` is the property `--a:b`).
        let colon = -1
        for (let j = 0; j < text.length && colon < 0; j++) {
          if (text[j] === '\\') j += cssEscapeLength(text, j) - 1
          else if (text[j] === ':') colon = j
        }
        push(
          {
            type: 'decl',
            property: (colon < 0 ? text : text.slice(0, colon)).trim(),
            value: colon < 0 ? '' : text.slice(colon + 1).trim(),
          },
          start
        )
      }
    }
  }

  return parseBlock(topSpans)
}

const PREFLIGHT_SELECTOR =
  /(^|[\s,>+~(])(html|body|:root|:host|::file-selector-button|::placeholder)\b|(^|,)\s*\*/

function declarations(nodes: CssNode[] | null, out: { property: string; value: string }[] = []) {
  for (const node of nodes ?? []) {
    if (node.type === 'decl') out.push(node)
    else declarations(node.children, out)
  }
  return out
}

/** Every way `css` breaks the rule; empty when it is utilities only. */
export function checkUtilitiesOnly(css: string): CssRuleProblem[] {
  const problems: CssRuleProblem[] = []
  const nodes = parseCss(css)

  for (const decl of declarations(nodes)) {
    if (/^--color-/.test(decl.property)) {
      problems.push({ kind: 'token', detail: `defines the token ${decl.property}` })
    }
  }

  const visitTop = (list: CssNode[]) => {
    for (const node of list) {
      if (node.type === 'decl') {
        problems.push({
          kind: 'not-utilities',
          detail: `a declaration outside any rule: ${node.property}`,
        })
        continue
      }
      if (node.type === 'rule') {
        const preflight = PREFLIGHT_SELECTOR.test(node.selector)
        problems.push({
          kind: preflight ? 'preflight' : 'not-utilities',
          detail: `an unlayered rule "${node.selector}"${preflight ? ' (a preflight/base rule)' : ''}`,
        })
        continue
      }
      const prelude = node.prelude
      switch (node.name) {
        case 'layer': {
          if (node.children === null) continue // `@layer theme, base, utilities;` only orders layers
          if (prelude === 'utilities') continue
          if (prelude === 'properties') {
            for (const d of declarations(node.children)) {
              if (!d.property.startsWith('--tw-')) {
                problems.push({
                  kind: 'not-utilities',
                  detail: `@layer properties sets ${d.property}`,
                })
              }
            }
            continue
          }
          if (prelude === 'base')
            problems.push({ kind: 'preflight', detail: '@layer base (preflight lives there)' })
          else if (prelude === 'theme')
            problems.push({ kind: 'token', detail: '@layer theme (token values)' })
          else
            problems.push({ kind: 'not-utilities', detail: `@layer ${prelude || '(anonymous)'}` })
          continue
        }
        case 'property':
          if (!prelude.startsWith('--tw-')) {
            problems.push({ kind: 'not-utilities', detail: `@property ${prelude}` })
          }
          continue
        case 'keyframes':
        case '-webkit-keyframes':
          continue
        case 'media':
        case 'supports':
        case 'container':
          visitTop(node.children ?? [])
          continue
        default:
          problems.push({ kind: 'not-utilities', detail: `@${node.name} ${prelude}`.trim() })
      }
    }
  }
  visitTop(nodes)
  return problems
}
