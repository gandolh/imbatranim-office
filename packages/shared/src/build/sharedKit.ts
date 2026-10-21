/**
 * The externals (OS brief 163, decision 1): the five modules the desktop lends
 * never enter a bundle. Every import of them, named, default, namespace,
 * re-export or dynamic, and the `react/jsx-runtime` imports the JSX transform
 * writes, resolves to a small generated module that reads the export from
 * `globalThis.__imbatranimShared.modules['<specifier>']` when it is evaluated.
 *
 * The generated modules are ordinary modules in the graph, so the bundler
 * orders their evaluation before every importer, and an export no app uses is
 * tree-shaken (each read is a `@__PURE__` call). Values are read from the
 * global, never copied: `useState` in an app is the desktop's `useState`.
 */
import type { Plugin } from 'vite'

/** The specifiers the desktop lends, in the global's key order. */
export const SHARED_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@imbatranim/ui',
] as const

export type SharedSpecifier = (typeof SHARED_SPECIFIERS)[number]

/** The global the desktop sets before it imports any kit app. */
export const SHARED_GLOBAL = '__imbatranimShared'

/** The value exports of one shared module, and whether it has a default export. */
export type ModuleExports = { names: readonly string[]; hasDefault: boolean }
export type SharedExports = Record<SharedSpecifier, ModuleExports>

const MODULE_PREFIX = '\0imbatranim-shared:'
const RUNTIME_ID = '\0imbatranim-shared-runtime'

export function isSharedSpecifier(source: string): source is SharedSpecifier {
  return (SHARED_SPECIFIERS as readonly string[]).includes(source)
}

/** The three readers every generated module calls. Kept tiny: it ships in every build. */
const RUNTIME = `
function lent(specifier) {
  const shared = globalThis.${SHARED_GLOBAL};
  const mod = shared == null || shared.modules == null ? undefined : shared.modules[specifier];
  if (mod == null) {
    throw new Error('imbatranim-office: the desktop lends no "' + specifier + '" (globalThis.${SHARED_GLOBAL}.modules is missing it). A kit app runs only inside imbatranimOS, which sets the shared kit before it loads one.');
  }
  return mod;
}
// A name the desktop's module lacks reads as undefined rather than throwing: a
// namespace import (common in bundled libraries) reads every name up front, and
// one the app never calls must not stop it loading.
export function sharedExport(specifier, name) {
  return lent(specifier)[name];
}
export function sharedDefault(specifier) {
  const mod = lent(specifier);
  return 'default' in mod ? mod.default : mod;
}
`

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const RESERVED = new Set(
  (
    'await break case catch class const continue debugger default delete do else enum export extends ' +
    'false finally for function if implements import in instanceof interface let new null package private ' +
    'protected public return static super switch this throw true try typeof var void while with yield'
  ).split(' ')
)

/** The source of the generated module that stands in for `specifier`. */
export function sharedModuleSource(specifier: SharedSpecifier, exports: ModuleExports): string {
  const spec = JSON.stringify(specifier)
  const lines = [
    `// "${specifier}", lent by the desktop at runtime (imbatranimOS brief 163). Generated, not bundled.`,
    `import { sharedExport, sharedDefault } from ${JSON.stringify(RUNTIME_ID)};`,
  ]
  if (exports.hasDefault) lines.push(`export default /* @__PURE__ */ sharedDefault(${spec});`)
  exports.names.forEach((name, i) => {
    if (name === 'default') return
    const read = `/* @__PURE__ */ sharedExport(${spec}, ${JSON.stringify(name)})`
    if (IDENTIFIER.test(name) && !RESERVED.has(name)) lines.push(`export const ${name} = ${read};`)
    else lines.push(`const e${i} = ${read};`, `export { e${i} as ${JSON.stringify(name)} };`)
  })
  return `${lines.join('\n')}\n`
}

/**
 * Resolve the five shared specifiers to generated modules that read the
 * desktop's global. `exports` lists what each module exports; a name an app
 * imports that is not listed fails the build, which is the point: it would be
 * undefined in the desktop too.
 */
export function sharedKitExternals(options: {
  exports: SharedExports | (() => SharedExports)
}): Plugin {
  let exports: SharedExports | null = null
  const resolveExports = () => {
    exports ??= typeof options.exports === 'function' ? options.exports() : options.exports
    return exports
  }
  return {
    name: 'imbatranim-office:shared-kit',
    enforce: 'pre',
    // Production JSX whatever NODE_ENV says (Vitest sets "test", which would make
    // the transform import react/jsx-dev-runtime, a module the desktop does not lend).
    config: () => ({
      oxc: { jsx: { runtime: 'automatic', importSource: 'react', development: false } },
    }),
    buildStart() {
      resolveExports()
    },
    resolveId(source) {
      if (source === RUNTIME_ID) return { id: RUNTIME_ID, moduleSideEffects: false }
      if (isSharedSpecifier(source)) return { id: MODULE_PREFIX + source, moduleSideEffects: false }
      if (source === 'react/jsx-dev-runtime') {
        this.error(
          'react/jsx-dev-runtime: development JSX reached the build. The desktop lends react/jsx-runtime only; build JSX for production.'
        )
      }
      if (source.startsWith('@imbatranim/ui/')) {
        this.error(
          `"${source}": the kit is lent as one module; import from "@imbatranim/ui" itself.`
        )
      }
      if (source === '@imbatranim/core' || source.startsWith('@imbatranim/core/')) {
        this.error(
          `"${source}" is the desktop's own package; an app reaches the OS through useSystem().`
        )
      }
      return null
    },
    load(id) {
      if (id === RUNTIME_ID) return RUNTIME
      if (!id.startsWith(MODULE_PREFIX)) return null
      const specifier = id.slice(MODULE_PREFIX.length) as SharedSpecifier
      return sharedModuleSource(specifier, resolveExports()[specifier])
    },
  }
}

/**
 * For worker bundles. A worker has its own global scope, where the desktop's
 * shared kit does not exist, so a worker that imports React or the kit is a
 * build error rather than a crash on the first message.
 */
export function noSharedKitInWorkers(): Plugin {
  return {
    name: 'imbatranim-office:no-shared-kit-in-workers',
    enforce: 'pre',
    resolveId(source, importer) {
      if (isSharedSpecifier(source) || source.startsWith('@imbatranim/ui/')) {
        this.error(
          `${importer ?? 'a worker'} imports "${source}" inside a worker. The shared kit lives on the page's global, which a worker cannot see; keep React and the kit out of worker code.`
        )
      }
      return null
    },
  }
}

/** A bare import of a shared specifier in emitted code: `from "react"`, `import("react")`, `import "react"`. */
export const BARE_SHARED_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](?:react|react\/jsx-runtime|react-dom|react-dom\/client|@imbatranim\/ui)["']/
