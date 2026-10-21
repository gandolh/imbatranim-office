/**
 * The kit snapshot: `vendor/imbatranim-ui/src` is the OS's `packages/ui/src`
 * at one commit, byte for byte (OS brief 163, decision 7). This module reads
 * that commit straight from a checkout's git objects (never its working tree),
 * writes the copy, and records what it copied in `vendor/imbatranim-ui/COMMIT`.
 *
 * Node-only. Run through `npm run kit:sync -- <os-checkout> <commit>`
 * (tools/kit-sync.ts); the build reads COMMIT through {@link readKitSnapshot}.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

/** Where the kit lives in the OS repo. */
export const KIT_SRC_IN_OS = 'packages/ui/src'
/** Where the token block lived before OS brief 163 moved it into the kit. */
export const THEME_FALLBACK_IN_OS = 'apps/core/src/index.css'
/** The kit's own token file, once the OS has one (relative to the snapshot's `src`). */
export const KIT_THEME_FILE = 'theme.css'
/** The stand-in kit:sync writes beside `src` while the kit has no theme.css. */
export const PROVISIONAL_THEME_FILE = 'theme.provisional.css'

/**
 * The shared modules (and the kit's own imports) this repo pins to what the
 * OS's lockfile resolves at the snapshot's commit. `via` is where the desktop
 * resolves each from: a workspace directory, then (for a dependency of a
 * dependency) the package that depends on it.
 */
export const TRACKED_PINS: readonly { name: string; via: readonly string[] }[] = [
  { name: 'react', via: ['apps/core'] },
  { name: 'react-dom', via: ['apps/core'] },
  { name: '@types/react', via: ['apps/core'] },
  { name: '@types/react-dom', via: ['apps/core'] },
  { name: 'tailwindcss', via: ['apps/core'] },
  { name: '@tailwindcss/node', via: ['apps/core', '@tailwindcss/vite'] },
  { name: '@tailwindcss/oxide', via: ['apps/core', '@tailwindcss/vite'] },
  { name: '@base-ui/react', via: ['packages/ui'] },
  { name: '@tanstack/react-query', via: ['packages/ui'] },
  { name: '@tanstack/react-virtual', via: ['packages/ui'] },
  { name: 'clsx', via: ['packages/ui'] },
  { name: 'tailwind-merge', via: ['packages/ui'] },
  { name: 'lucide-react', via: ['packages/ui'] },
]

export type KitCommit = {
  /** The full OS commit id the snapshot was copied from. */
  commit: string
  /** The kit's `SHARED_KIT_VERSION` at that commit; null while the kit has none (before OS 163). */
  sharedKitVersion: number | null
  /** The token file the CSS build reads, relative to `vendor/imbatranim-ui`. */
  theme: string
}

export function formatKitCommit(info: KitCommit): string {
  return [
    '# vendor/imbatranim-ui/src is packages/ui/src of imbatranimOS at this commit, byte for byte.',
    '# Written by `npm run kit:sync -- <os-checkout> <commit>`; do not edit by hand.',
    ...(info.sharedKitVersion === null
      ? ['# SHARED_KIT_VERSION=absent: the kit at this commit exports none (OS brief 163 adds it).']
      : []),
    '# theme: the token file the CSS build reads, relative to this directory.',
    `commit=${info.commit}`,
    `SHARED_KIT_VERSION=${info.sharedKitVersion ?? 'absent'}`,
    `theme=${info.theme}`,
    '',
  ].join('\n')
}

export function parseKitCommit(text: string): KitCommit {
  const fields = new Map<string, string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) throw new Error(`COMMIT: cannot read the line "${line}"`)
    fields.set(line.slice(0, eq), line.slice(eq + 1))
  }
  const commit = fields.get('commit') ?? ''
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) {
    throw new Error(`COMMIT: "commit" must be a full commit id, got "${commit}"`)
  }
  const version = fields.get('SHARED_KIT_VERSION') ?? ''
  if (version !== 'absent' && !/^[1-9]\d*$/.test(version)) {
    throw new Error(
      `COMMIT: SHARED_KIT_VERSION must be a positive integer or "absent", got "${version}"`
    )
  }
  const theme = fields.get('theme') ?? ''
  if (theme === '' || theme.includes('..')) {
    throw new Error(`COMMIT: "theme" must name a file inside vendor/imbatranim-ui, got "${theme}"`)
  }
  return { commit, sharedKitVersion: version === 'absent' ? null : Number(version), theme }
}

export type KitSnapshot = KitCommit & {
  /** `vendor/imbatranim-ui` */
  dir: string
  /** `vendor/imbatranim-ui/src` */
  srcDir: string
  /** The kit's barrel, `src/index.ts`. */
  index: string
  /** Absolute path of the token file. */
  themeCss: string
}

/** Read the snapshot the build works against. Throws a sentence when it is incomplete. */
export function readKitSnapshot(vendorDir: string): KitSnapshot {
  const commitFile = join(vendorDir, 'COMMIT')
  if (!existsSync(commitFile)) {
    throw new Error(`${commitFile} is missing: run npm run kit:sync -- <os-checkout> <commit>`)
  }
  const info = parseKitCommit(readFileSync(commitFile, 'utf8'))
  const snapshot: KitSnapshot = {
    ...info,
    dir: vendorDir,
    srcDir: join(vendorDir, 'src'),
    index: join(vendorDir, 'src', 'index.ts'),
    themeCss: join(vendorDir, info.theme),
  }
  for (const file of [snapshot.index, snapshot.themeCss]) {
    if (!existsSync(file))
      throw new Error(`${file} is missing from the kit snapshot: re-run kit:sync`)
  }
  return snapshot
}

/**
 * The `@theme { … }` block of a stylesheet, from `@theme` to its closing brace,
 * exactly as written. Used while the kit has no theme.css of its own.
 */
export function extractThemeBlock(css: string): string {
  const match = /^@theme\s*\{/m.exec(css)
  if (!match) throw new Error('no top-level "@theme {" block to extract')
  let depth = 0
  for (let i = match.index; i < css.length; i++) {
    if (css.startsWith('/*', i)) {
      const close = css.indexOf('*/', i + 2)
      if (close < 0) break
      i = close + 1
      continue
    }
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      const close = css.indexOf(ch, i + 1)
      if (close < 0) break
      i = close
      continue
    }
    if (ch === '{') depth++
    if (ch === '}' && --depth === 0) return css.slice(match.index, i + 1)
  }
  throw new Error('the "@theme" block never closes')
}

export function provisionalTheme(commit: string, block: string): string {
  return [
    '/*',
    ` * PROVISIONAL. Written by \`npm run kit:sync\` from imbatranimOS ${commit},`,
    ' * whose kit has no theme.css yet: this is the @theme block of',
    ` * ${THEME_FALLBACK_IN_OS} at that commit. OS brief 163 moves the block to`,
    " * packages/ui/src/theme.css; the first kit:sync after that copies the kit's",
    ' * own file into src/ and deletes this one.',
    ' */',
    block,
    '',
  ].join('\n')
}

// ── git, objects only ─────────────────────────────────────────────────────────

function git(osDir: string, args: string[]): Buffer {
  const run = spawnSync('git', ['-C', osDir, ...args], {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
  })
  if (run.error) throw run.error
  if (run.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${osDir}: ${run.stderr.toString().trim()}`)
  }
  return run.stdout
}

/** The id git gives these bytes as a blob (what `git hash-object` prints). */
export function blobId(bytes: Buffer, idLength: number): string {
  const algorithm = idLength === 64 ? 'sha256' : 'sha1'
  return createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

type TreeFile = { path: string; mode: string; oid: string; bytes: Buffer }

function readTree(osDir: string, commit: string, prefix: string): TreeFile[] {
  const listing = git(osDir, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', prefix])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const files: TreeFile[] = []
  for (const entry of listing) {
    const tab = entry.indexOf('\t')
    const [mode, type, oid] = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      throw new Error(
        `${path} at ${commit} is a ${type} (mode ${mode}); the snapshot copies plain files only`
      )
    }
    const bytes = git(osDir, ['cat-file', 'blob', oid])
    if (blobId(bytes, oid.length) !== oid)
      throw new Error(`${path}: blob ${oid} read back with other bytes`)
    files.push({ path: path.slice(prefix.length + 1), mode, oid, bytes })
  }
  return files
}

function readBlob(osDir: string, commit: string, path: string): Buffer {
  return git(osDir, ['cat-file', 'blob', `${commit}:${path}`])
}

type LockFile = { packages: Record<string, { version?: string }> }
type PackageJson = { devDependencies?: Record<string, string> } & Record<string, unknown>

/** The version npm installed for `name` when resolved from `via`, per a lockfile. */
export function resolveInLock(lock: LockFile, via: readonly string[], name: string): string | null {
  let from = via[0]
  for (const step of [...via.slice(1), name]) {
    const found = lockLookup(lock, from, step)
    if (!found) return null
    from = found
  }
  return lock.packages[from]?.version ?? null
}

/** Node's walk, on lockfile keys: `<dir>/node_modules/<name>` for `from` and each ancestor. */
function lockLookup(lock: LockFile, from: string, name: string): string | null {
  const parts = from === '' ? [] : from.split('/')
  for (let n = parts.length; n >= 0; n--) {
    const dir = parts.slice(0, n)
    if (dir[dir.length - 1] === 'node_modules') continue
    const key = [...dir, 'node_modules', name].join('/')
    if (lock.packages[key]) return key
  }
  return null
}

// ── the sync ──────────────────────────────────────────────────────────────────

export type SyncOptions = {
  /** A local imbatranimOS checkout. Only its git objects are read. */
  osDir: string
  /** Any name git resolves to a commit there; COMMIT records the full id. */
  commit: string
  /** `vendor/imbatranim-ui` */
  vendorDir: string
  /** The root package.json whose devDependencies hold the {@link TRACKED_PINS}. */
  packageJson?: string
  /** Compare only: write nothing, report every difference. */
  check?: boolean
}

export type SyncResult = {
  commit: string
  files: number
  sharedKitVersion: number | null
  theme: string
  /** What differs between the commit and the files on disk (before writing, in check mode). */
  differences: string[]
  /** Pins that differ from the OS lockfile; rewritten in package.json unless checking. */
  pinChanges: { name: string; from: string | null; to: string }[]
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

export function syncKit(options: SyncOptions): SyncResult {
  const { osDir, vendorDir } = options
  const commit = git(osDir, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${options.commit}^{commit}`,
  ])
    .toString('utf8')
    .trim()

  const files = readTree(osDir, commit, KIT_SRC_IN_OS)
  if (files.length === 0) throw new Error(`${KIT_SRC_IN_OS} is empty or absent at ${commit}`)

  // The token names: the kit's own file once it has one, the desktop's block before.
  const hasKitTheme = files.some((f) => f.path === KIT_THEME_FILE)
  const theme = hasKitTheme ? `src/${KIT_THEME_FILE}` : PROVISIONAL_THEME_FILE
  const provisional = hasKitTheme
    ? null
    : Buffer.from(
        provisionalTheme(
          commit,
          extractThemeBlock(readBlob(osDir, commit, THEME_FALLBACK_IN_OS).toString('utf8'))
        )
      )

  let sharedKitVersion: number | null = null
  for (const f of files) {
    if (!/\.tsx?$/.test(f.path)) continue
    const m = /export\s+const\s+SHARED_KIT_VERSION\s*(?::\s*\w+\s*)?=\s*(\d+)/.exec(
      f.bytes.toString('utf8')
    )
    if (m) sharedKitVersion = Number(m[1])
  }

  const commitText = Buffer.from(formatKitCommit({ commit, sharedKitVersion, theme }))

  // Differences against what is on disk now.
  const srcDir = join(vendorDir, 'src')
  const differences: string[] = []
  const wanted = new Map(files.map((f) => [f.path, f]))
  const present = listFiles(srcDir)
  for (const path of present)
    if (!wanted.has(path)) differences.push(`src/${path}: not in the commit`)
  for (const f of files) {
    const onDisk = join(srcDir, f.path)
    if (!existsSync(onDisk)) differences.push(`src/${f.path}: missing`)
    else if (!readFileSync(onDisk).equals(f.bytes)) differences.push(`src/${f.path}: differs`)
  }
  const provisionalPath = join(vendorDir, PROVISIONAL_THEME_FILE)
  if (provisional === null && existsSync(provisionalPath)) {
    differences.push(`${PROVISIONAL_THEME_FILE}: should be gone (the kit has theme.css)`)
  }
  if (
    provisional !== null &&
    !(existsSync(provisionalPath) && readFileSync(provisionalPath).equals(provisional))
  ) {
    differences.push(`${PROVISIONAL_THEME_FILE}: missing or differs`)
  }
  const commitPath = join(vendorDir, 'COMMIT')
  if (!(existsSync(commitPath) && readFileSync(commitPath).equals(commitText))) {
    differences.push('COMMIT: missing or differs')
  }

  // Pins against the OS lockfile.
  const pinChanges: SyncResult['pinChanges'] = []
  let pkg: PackageJson | null = null
  if (options.packageJson) {
    const lock = JSON.parse(
      readBlob(osDir, commit, 'package-lock.json').toString('utf8')
    ) as LockFile
    pkg = JSON.parse(readFileSync(options.packageJson, 'utf8')) as PackageJson
    for (const pin of TRACKED_PINS) {
      const to = resolveInLock(lock, pin.via, pin.name)
      if (to === null)
        throw new Error(
          `the OS lockfile at ${commit} resolves no ${pin.name} from ${pin.via.join(' > ')}`
        )
      const from = pkg.devDependencies?.[pin.name] ?? null
      if (from !== to) pinChanges.push({ name: pin.name, from, to })
    }
  }

  const result: SyncResult = {
    commit,
    files: files.length,
    sharedKitVersion,
    theme,
    differences,
    pinChanges,
  }
  if (options.check) return result

  // Write: a clean replace, so files the commit dropped disappear.
  rmSync(srcDir, { recursive: true, force: true })
  for (const f of files) {
    const target = join(srcDir, f.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, f.bytes)
    chmodSync(target, f.mode === '100755' ? 0o755 : 0o644)
  }
  if (provisional === null) rmSync(provisionalPath, { force: true })
  else writeFileSync(provisionalPath, provisional)
  writeFileSync(commitPath, commitText)

  // Read every file back and hash it as git would: the copy is the commit's tree.
  const written = listFiles(srcDir)
  if (written.length !== files.length)
    throw new Error('the written snapshot has a different file count')
  for (const f of files) {
    if (blobId(readFileSync(join(srcDir, f.path)), f.oid.length) !== f.oid) {
      throw new Error(`src/${f.path} does not hash to ${f.oid} after writing`)
    }
  }

  if (options.packageJson && pkg && pinChanges.length > 0) {
    pkg.devDependencies = { ...pkg.devDependencies }
    for (const change of pinChanges) pkg.devDependencies[change.name] = change.to
    pkg.devDependencies = Object.fromEntries(
      Object.entries(pkg.devDependencies).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    )
    writeFileSync(options.packageJson, `${JSON.stringify(pkg, null, 2)}\n`)
  }
  return result
}
