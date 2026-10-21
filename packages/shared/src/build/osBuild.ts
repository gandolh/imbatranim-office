/**
 * `npm run build:os`: the build the OS's marketplace runs at install, in its
 * container, after `npm ci` (argv only, no shell, no network).
 *
 * One Vite library build, ES modules only, one entry per app:
 *
 *   dist/os/<app>/app.mjs      exports App, the component the desktop renders
 *   dist/os/<app>/app.css      the app's Tailwind utilities (appCss.ts)
 *   dist/os/chunks/*.mjs       code two or more entries share
 *   dist/os/workers/*.mjs      each `new Worker(new URL('./x.ts', import.meta.url))`
 *
 * Every URL is relative (`base: './'`), so the tree works wherever the OS
 * serves `dist/os`.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin, UserConfig } from 'vite'
import { appStyles } from './appCss.ts'
import { readSharedExports } from './exportNames.ts'
import { readKitSnapshot } from './kitSnapshot.ts'
import { BARE_SHARED_IMPORT, noSharedKitInWorkers, sharedKitExternals } from './sharedKit.ts'

export type OsApp = {
  /** The directory name under `apps/`, and the output directory under `dist/os/`. */
  name: string
  /** `apps/<name>` */
  dir: string
  /** `apps/<name>/src/App.tsx`, the module the desktop imports. */
  entry: string
}

const APP_NAME = /^[a-z][a-z0-9-]*$/

/**
 * Every `apps/<name>` that has `src/App.tsx` is an app: adding a workspace
 * with that file is all it takes to add one to the build.
 */
export function discoverApps(root: string): OsApp[] {
  const appsDir = join(root, 'apps')
  if (!existsSync(appsDir)) return []
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(appsDir, d.name, 'src', 'App.tsx')))
    .map((d) => {
      if (!APP_NAME.test(d.name)) {
        throw new Error(`apps/${d.name}: an app directory is lowercase letters, digits and "-"`)
      }
      const dir = join(appsDir, d.name)
      return { name: d.name, dir, entry: join(dir, 'src', 'App.tsx') }
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

/** Checks on the finished bundle that would otherwise surface as a broken window. */
export function osOutputChecks(options: { apps: readonly OsApp[]; kitNotice?: string }): Plugin {
  return {
    name: 'imbatranim-office:output-checks',
    enforce: 'post',
    buildStart() {
      if (options.kitNotice) this.warn(options.kitNotice)
    },
    generateBundle(_output, bundle) {
      for (const app of options.apps) {
        const chunk = bundle[`${app.name}/app.mjs`]
        if (!chunk || chunk.type !== 'chunk' || !chunk.isEntry) {
          this.error(`${app.name}/app.mjs was not emitted`)
        } else if (!chunk.exports.includes('App')) {
          this.error(
            `apps/${app.name}/src/App.tsx must export App, the component the desktop renders`
          )
        }
      }
      for (const file of Object.values(bundle)) {
        if (!/\.m?js$/.test(file.fileName)) continue
        const code = file.type === 'chunk' ? file.code : String(file.source)
        if (BARE_SHARED_IMPORT.test(code)) {
          this.error(
            `${file.fileName} still imports a shared module by name; the desktop lends those on its global`
          )
        }
        if (/\bprocess\.env\b/.test(code)) {
          this.error(`${file.fileName} reads process.env, which does not exist in the browser`)
        }
      }
    },
  }
}

export type OsBuildOptions = {
  /** The repo root. */
  root: string
  /** Defaults to `<root>/dist/os`. */
  outDir?: string
  /** The kit snapshot; defaults to `<root>/vendor/imbatranim-ui`. */
  vendorDir?: string
}

/** The whole Vite config of `npm run build:os`. */
export function osBuildConfig(options: OsBuildOptions): UserConfig {
  const { root } = options
  const apps = discoverApps(root)
  if (apps.length === 0)
    throw new Error(`no apps: nothing under ${join(root, 'apps')} has src/App.tsx`)
  const kit = readKitSnapshot(options.vendorDir ?? join(root, 'vendor', 'imbatranim-ui'))
  const shared = join(root, 'packages', 'shared', 'src')

  return {
    root,
    base: './',
    publicDir: false,
    envDir: false,
    logLevel: 'info',
    plugins: [
      sharedKitExternals({ exports: () => readSharedExports({ root, kitIndex: kit.index }) }),
      appStyles({
        apps,
        themeCss: kit.themeCss,
        sharedSources: [shared],
        sharedExcludes: [join(shared, 'build'), join(shared, 'testing')],
      }),
      osOutputChecks({
        apps,
        kitNotice:
          kit.sharedKitVersion === null
            ? `kit snapshot ${kit.commit.slice(0, 7)} has no SHARED_KIT_VERSION (provisional, before OS brief 163)`
            : undefined,
      }),
    ],
    // Library mode leaves process.env alone for a consumer's bundler; here the
    // browser is the consumer, and bundled libraries read NODE_ENV.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    worker: {
      format: 'es',
      plugins: () => [noSharedKitInWorkers()],
      rolldownOptions: {
        output: {
          entryFileNames: 'workers/[name]-[hash].mjs',
          chunkFileNames: 'workers/[name]-[hash].mjs',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    build: {
      outDir: options.outDir ?? join(root, 'dist', 'os'),
      emptyOutDir: true,
      copyPublicDir: false,
      reportCompressedSize: false,
      lib: {
        entry: Object.fromEntries(apps.map((app) => [`${app.name}/app`, app.entry])),
        formats: ['es'],
        fileName: (_format, entryName) => `${entryName}.mjs`,
      },
      rolldownOptions: {
        output: {
          chunkFileNames: 'chunks/[name]-[hash].mjs',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  }
}
