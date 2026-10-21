/**
 * What each shared module exports, read from the exact versions this repo
 * pins (the OS's) and from the kit snapshot, so the generated stand-ins in
 * sharedKit.ts list the same names the desktop's namespaces carry.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import type { ModuleExports, SharedExports } from './sharedKit.ts'

const REACT_SPECIFIERS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] as const

/**
 * The export names of React's four lent modules, as the desktop's production
 * build sees them. Read in a child Node with NODE_ENV=production: React picks
 * its development or production file from NODE_ENV when it loads, the two
 * differ (development adds `act` and `captureOwnerStack`), and the build's own
 * process may already hold either in its module cache.
 */
export function reactExports(
  root: string
): Record<(typeof REACT_SPECIFIERS)[number], ModuleExports> {
  const script = [
    "const { createRequire } = require('node:module');",
    'const load = createRequire(process.argv[1]);',
    'const out = {};',
    'for (const s of JSON.parse(process.argv[2])) out[s] = Object.keys(load(s));',
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n')
  const run = spawnSync(
    process.execPath,
    ['-e', script, join(root, 'package.json'), JSON.stringify(REACT_SPECIFIERS)],
    { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } }
  )
  if (run.error) throw run.error
  if (run.status !== 0) throw new Error(`reading React's exports failed: ${run.stderr.trim()}`)
  const names = JSON.parse(run.stdout) as Record<string, string[]>
  // CommonJS modules: the default import is the whole module.exports.
  const read = (s: (typeof REACT_SPECIFIERS)[number]): ModuleExports => ({
    names: names[s].filter((n) => n !== 'default').sort(),
    hasDefault: true,
  })
  return {
    react: read('react'),
    'react/jsx-runtime': read('react/jsx-runtime'),
    'react-dom': read('react-dom'),
    'react-dom/client': read('react-dom/client'),
  }
}

/**
 * The value exports of the kit's barrel, read from its source without type
 * checking. The kit is built with `verbatimModuleSyntax`, so every type-only
 * re-export carries `type` and can be dropped by syntax alone. `export *` from
 * a relative module is followed.
 */
export function kitExports(indexFile: string): ModuleExports {
  const names = new Set<string>()
  let hasDefault = false

  const visit = (file: string, viaStar: boolean, seen: Set<string>) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind)
    const add = (name: string) => {
      if (name === 'default') {
        if (!viaStar) hasDefault = true
      } else names.add(name)
    }
    for (const st of source.statements) {
      if (ts.isExportDeclaration(st)) {
        if (st.isTypeOnly) continue
        if (!st.exportClause) {
          const spec = st.moduleSpecifier
          if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith('.')) {
            throw new Error(
              `${file}: "export *" from a package is not followed; list the names instead`
            )
          }
          visit(resolveRelative(file, spec.text), true, seen)
          continue
        }
        if (ts.isNamespaceExport(st.exportClause)) {
          add(st.exportClause.name.text)
          continue
        }
        for (const el of st.exportClause.elements) if (!el.isTypeOnly) add(el.name.text)
        continue
      }
      if (ts.isExportAssignment(st)) {
        if (!st.isExportEquals) add('default')
        continue
      }
      const modifiers = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined
      if (!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      if (modifiers.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
      const isDefault = modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name))
            throw new Error(`${file}: destructured exports are not read`)
          add(d.name.text)
        }
      } else if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
        if (isDefault) add('default')
        else if (st.name) add(st.name.text)
      } else if (ts.isEnumDeclaration(st)) {
        add(st.name.text)
      }
      // Interfaces, type aliases and ambient declarations are types: no value to lend.
    }
  }

  visit(resolve(indexFile), false, new Set())
  return { names: [...names].sort(), hasDefault }
}

function resolveRelative(from: string, spec: string): string {
  const base = resolve(dirname(from), spec)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  const found = candidates.find((c) => existsSync(c) && /\.tsx?$/.test(c))
  if (!found) throw new Error(`${from}: cannot find "${spec}"`)
  return found
}

/** Every shared module's exports: React's from the installed pins, the kit's from the snapshot. */
export function readSharedExports(options: { root: string; kitIndex: string }): SharedExports {
  return { ...reactExports(options.root), '@imbatranim/ui': kitExports(options.kitIndex) }
}
