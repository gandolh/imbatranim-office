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
  kind: 'preflight' | 'token' | 'not-utilities'
  detail: string
}

type CssNode =
  | { type: 'at'; name: string; prelude: string; children: CssNode[] | null }
  | { type: 'rule'; selector: string; children: CssNode[] }
  | { type: 'decl'; property: string; value: string }

/** Parse well-formed CSS into at-rules, style rules and declarations (nesting allowed). */
export function parseCss(css: string): CssNode[] {
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

  /** Read up to (not including) the first `{`, `;` or `}` outside strings, comments and parentheses. */
  const readPrelude = (): { text: string; stop: string } => {
    let text = ''
    let parens = 0
    while (i < n) {
      if (css.startsWith('/*', i)) {
        skipComment()
        continue
      }
      const ch = css[i]
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

  const parseBlock = (): CssNode[] => {
    const nodes: CssNode[] = []
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
      const { text, stop } = readPrelude()
      if (stop === '{') {
        i++
        const children = parseBlock()
        if (text.startsWith('@')) {
          const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(text)
          nodes.push({
            type: 'at',
            name: (m?.[1] ?? '').toLowerCase(),
            prelude: (m?.[2] ?? '').trim(),
            children,
          })
        } else {
          nodes.push({ type: 'rule', selector: text, children })
        }
        continue
      }
      if (stop === ';') i++
      if (text === '') continue
      if (text.startsWith('@')) {
        const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(text)
        nodes.push({
          type: 'at',
          name: (m?.[1] ?? '').toLowerCase(),
          prelude: (m?.[2] ?? '').trim(),
          children: null,
        })
      } else {
        const colon = text.indexOf(':')
        nodes.push({
          type: 'decl',
          property: (colon < 0 ? text : text.slice(0, colon)).trim(),
          value: colon < 0 ? '' : text.slice(colon + 1).trim(),
        })
      }
    }
  }

  return parseBlock()
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
