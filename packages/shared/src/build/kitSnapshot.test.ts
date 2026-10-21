import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  blobId,
  extractThemeBlock,
  formatKitCommit,
  parseKitCommit,
  readKitSnapshot,
  resolveInLock,
  syncKit,
} from './kitSnapshot.ts'

const scratch = mkdtempSync(join(tmpdir(), 'imbatranim-kit-sync-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function git(dir: string, ...args: string[]): string {
  const run = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  })
  if (run.status !== 0) throw new Error(run.stderr)
  return run.stdout.trim()
}

function write(root: string, path: string, content: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

const INDEX_CSS = `@import 'tailwindcss';

/* tokens */
@theme {
  --color-primary: var(--accent); /* a } in a comment */
  --font-ui: 'Space Grotesk', sans-serif;
}

:root { --accent: #c0263a; }
`

const lock = (react: string) =>
  JSON.stringify({
    packages: {
      '': {},
      'apps/core': {},
      'packages/ui': {},
      'node_modules/react': { version: react },
      'node_modules/react-dom': { version: react },
      'node_modules/@types/react': { version: '19.2.17' },
      'node_modules/@types/react-dom': { version: '19.2.3' },
      'node_modules/tailwindcss': { version: '4.3.3' },
      'node_modules/@tailwindcss/vite': { version: '4.3.3' },
      'node_modules/@tailwindcss/node': { version: '4.3.3' },
      'node_modules/@tailwindcss/oxide': { version: '4.3.3' },
      'node_modules/@base-ui/react': { version: '1.6.0' },
      'packages/ui/node_modules/@base-ui/react': { version: '1.7.0' },
      'node_modules/@tanstack/react-query': { version: '5.101.2' },
      'node_modules/@tanstack/react-virtual': { version: '3.14.6' },
      'node_modules/clsx': { version: '2.1.1' },
      'node_modules/tailwind-merge': { version: '3.6.0' },
      'node_modules/lucide-react': { version: '1.24.0' },
    },
  })

let os: string
let first: string
let second: string

beforeAll(() => {
  os = join(scratch, 'os')
  mkdirSync(os)
  git(os, 'init', '-q', '-b', 'main')
  // Commit one: no theme.css in the kit yet, no SHARED_KIT_VERSION. CRLF and
  // non-UTF-8 bytes must survive untouched.
  write(os, 'packages/ui/src/index.ts', "export { Button } from './Button'\r\n")
  write(os, 'packages/ui/src/Button.tsx', 'export function Button() {\n  return null\n}\n')
  write(os, 'packages/ui/src/lib/bytes.bin', Buffer.from([0, 255, 13, 10, 128]))
  write(os, 'apps/core/src/index.css', INDEX_CSS)
  write(os, 'package-lock.json', lock('19.2.7'))
  git(os, 'add', '-A')
  git(os, 'commit', '-q', '-m', 'one')
  first = git(os, 'rev-parse', 'HEAD')
  // Commit two: OS brief 163 landed. theme.css moves in, the version arrives, a file goes.
  write(os, 'packages/ui/src/theme.css', '@theme {\n  --color-primary: var(--accent);\n}\n')
  write(
    os,
    'packages/ui/src/index.ts',
    "export { Button } from './Button'\nexport const SHARED_KIT_VERSION = 1\n"
  )
  rmSync(join(os, 'packages/ui/src/lib/bytes.bin'))
  write(os, 'package-lock.json', lock('19.3.0'))
  git(os, 'add', '-A')
  git(os, 'commit', '-q', '-m', 'two')
  second = git(os, 'rev-parse', 'HEAD')
  // A dirty working tree that must never be read.
  write(os, 'packages/ui/src/index.ts', 'WORKING TREE, NOT THE COMMIT\n')
  write(os, 'packages/ui/src/untracked.ts', 'untracked\n')
})

function vendor(name: string) {
  const dir = join(scratch, name)
  const pkg = join(scratch, `${name}.package.json`)
  writeFileSync(
    pkg,
    `${JSON.stringify({ name: 'x', devDependencies: { react: '19.2.7', vite: '8.1.5' } }, null, 2)}\n`
  )
  return { dir, pkg }
}

describe('kit:sync', () => {
  it('copies the commit from git objects, byte for byte, whatever the working tree holds', () => {
    const { dir, pkg } = vendor('v-first')
    const result = syncKit({
      osDir: os,
      commit: first.slice(0, 7),
      vendorDir: dir,
      packageJson: pkg,
    })
    expect(result.commit).toBe(first)
    expect(result.files).toBe(3)
    expect(readFileSync(join(dir, 'src/index.ts'), 'utf8')).toBe(
      "export { Button } from './Button'\r\n"
    )
    expect(readFileSync(join(dir, 'src/lib/bytes.bin'))).toEqual(Buffer.from([0, 255, 13, 10, 128]))
    expect(existsSync(join(dir, 'src/untracked.ts'))).toBe(false)
    for (const path of ['index.ts', 'Button.tsx', 'lib/bytes.bin']) {
      const oid = git(os, 'rev-parse', `${first}:packages/ui/src/${path}`)
      expect(blobId(readFileSync(join(dir, 'src', path)), oid.length)).toBe(oid)
    }
  })

  it('writes the desktop @theme block as a provisional token file while the kit has none', () => {
    const { dir, pkg } = vendor('v-provisional')
    const result = syncKit({ osDir: os, commit: first, vendorDir: dir, packageJson: pkg })
    expect(result.theme).toBe('theme.provisional.css')
    expect(result.sharedKitVersion).toBeNull()
    const theme = readFileSync(join(dir, 'theme.provisional.css'), 'utf8')
    expect(theme).toContain('PROVISIONAL')
    expect(theme).toContain(first)
    expect(theme).toContain(
      "@theme {\n  --color-primary: var(--accent); /* a } in a comment */\n  --font-ui: 'Space Grotesk', sans-serif;\n}"
    )
    expect(theme).not.toContain(':root')
    const snapshot = readKitSnapshot(dir)
    expect(snapshot).toMatchObject({
      commit: first,
      sharedKitVersion: null,
      theme: 'theme.provisional.css',
    })
    expect(snapshot.themeCss).toBe(join(dir, 'theme.provisional.css'))
  })

  it('moves to the kit theme.css and SHARED_KIT_VERSION once the OS has them, in one run', () => {
    const { dir, pkg } = vendor('v-second')
    syncKit({ osDir: os, commit: first, vendorDir: dir, packageJson: pkg })
    const result = syncKit({ osDir: os, commit: second, vendorDir: dir, packageJson: pkg })
    expect(result).toMatchObject({ commit: second, sharedKitVersion: 1, theme: 'src/theme.css' })
    expect(existsSync(join(dir, 'theme.provisional.css'))).toBe(false)
    expect(existsSync(join(dir, 'src/lib/bytes.bin'))).toBe(false)
    expect(readKitSnapshot(dir)).toMatchObject({ sharedKitVersion: 1, theme: 'src/theme.css' })
    expect(readFileSync(join(dir, 'COMMIT'), 'utf8')).toContain('SHARED_KIT_VERSION=1\n')
  })

  it('moves the shared-module pins to what the OS lockfile resolves, resolved as the desktop would', () => {
    const { dir, pkg } = vendor('v-pins')
    const result = syncKit({ osDir: os, commit: second, vendorDir: dir, packageJson: pkg })
    expect(result.pinChanges).toContainEqual({ name: 'react', from: '19.2.7', to: '19.3.0' })
    // packages/ui has a nested @base-ui/react: the kit's own resolution wins over the hoisted one.
    expect(result.pinChanges).toContainEqual({ name: '@base-ui/react', from: null, to: '1.7.0' })
    const written = JSON.parse(readFileSync(pkg, 'utf8'))
    expect(written.devDependencies.react).toBe('19.3.0')
    expect(written.devDependencies.vite).toBe('8.1.5')
    expect(Object.keys(written.devDependencies)).toEqual(
      [...Object.keys(written.devDependencies)].sort()
    )
  })

  it('--check reports every difference and writes nothing', () => {
    const { dir, pkg } = vendor('v-check')
    syncKit({ osDir: os, commit: first, vendorDir: dir, packageJson: pkg })
    const clean = syncKit({
      osDir: os,
      commit: first,
      vendorDir: dir,
      packageJson: pkg,
      check: true,
    })
    expect(clean.differences).toEqual([])
    writeFileSync(join(dir, 'src/Button.tsx'), 'edited\n')
    writeFileSync(join(dir, 'src/extra.ts'), 'extra\n')
    const dirty = syncKit({
      osDir: os,
      commit: first,
      vendorDir: dir,
      packageJson: pkg,
      check: true,
    })
    expect(dirty.differences).toEqual([
      'src/extra.ts: not in the commit',
      'src/Button.tsx: differs',
    ])
    expect(readFileSync(join(dir, 'src/Button.tsx'), 'utf8')).toBe('edited\n')
  })

  it('refuses a name that is not a commit', () => {
    const { dir } = vendor('v-bad')
    expect(() => syncKit({ osDir: os, commit: 'no-such-ref', vendorDir: dir })).toThrow(/rev-parse/)
  })
})

describe('the COMMIT file', () => {
  it('round-trips', () => {
    const info = { commit: 'a'.repeat(40), sharedKitVersion: 3, theme: 'src/theme.css' }
    expect(parseKitCommit(formatKitCommit(info))).toEqual(info)
    const absent = { ...info, sharedKitVersion: null }
    expect(formatKitCommit(absent)).toContain('SHARED_KIT_VERSION=absent')
    expect(parseKitCommit(formatKitCommit(absent))).toEqual(absent)
  })

  it('refuses a short commit, a bad version and a theme outside the snapshot', () => {
    expect(() => parseKitCommit('commit=abc\nSHARED_KIT_VERSION=1\ntheme=x.css')).toThrow(
      /full commit/
    )
    expect(() =>
      parseKitCommit(`commit=${'a'.repeat(40)}\nSHARED_KIT_VERSION=0\ntheme=x.css`)
    ).toThrow(/positive/)
    expect(() =>
      parseKitCommit(`commit=${'a'.repeat(40)}\nSHARED_KIT_VERSION=1\ntheme=../x.css`)
    ).toThrow(/inside/)
  })

  it('names the snapshot this repo builds against', () => {
    const snapshot = readKitSnapshot(join(import.meta.dirname, '../../../../vendor/imbatranim-ui'))
    expect(snapshot.commit).toBe('3d7382535c18410204073d0e15c331a014531929')
  })
})

describe('extractThemeBlock and resolveInLock', () => {
  it('stop at the brace that closes @theme', () => {
    expect(extractThemeBlock('a{}\n@theme {\n  --x: "}";\n}\nb{}')).toBe('@theme {\n  --x: "}";\n}')
    expect(() => extractThemeBlock('a{}')).toThrow(/no top-level/)
  })

  it('walk node_modules the way Node does', () => {
    const l = JSON.parse(lock('19.2.7'))
    expect(resolveInLock(l, ['apps/core'], 'react')).toBe('19.2.7')
    expect(resolveInLock(l, ['packages/ui'], '@base-ui/react')).toBe('1.7.0')
    expect(resolveInLock(l, ['apps/core'], '@base-ui/react')).toBe('1.6.0')
    expect(resolveInLock(l, ['apps/core', '@tailwindcss/vite'], '@tailwindcss/node')).toBe('4.3.3')
    expect(resolveInLock(l, ['apps/core'], 'left-pad')).toBeNull()
  })
})
