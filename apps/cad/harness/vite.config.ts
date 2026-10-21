// The CAD harness: the app and a renderer benchmark in a plain browser page,
// outside the OS, for measuring and walking through it in Chrome.
//
//   CAD_FIXTURES=<folder of .dxf files> npx vite --config apps/cad/harness/vite.config.ts --port 5181
//
// /            the app inside a fake desktop handle (files live in memory)
// /perf.html   the renderer alone, with a scripted pan and zoom (?file=<name>)
// Files in CAD_FIXTURES are served at /fixtures/<name>; nothing else is read.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { compile, optimize } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { appCssSource, readKitSnapshot } from '../../../packages/shared/src/build/index.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))

function fixtures(): Plugin {
  const dir = process.env.CAD_FIXTURES
  return {
    name: 'cad-harness:fixtures',
    configureServer(server) {
      server.middlewares.use('/fixtures', (req, res) => {
        const name = basename(decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!dir) {
          res.statusCode = 404
          res.end('CAD_FIXTURES is not set')
          return
        }
        if (name === '' || name === 'index.json') {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(readdirSync(dir).filter((f) => /\.dxf$/i.test(f))))
          return
        }
        const path = join(dir, name)
        if (!existsSync(path)) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('content-type', 'application/octet-stream')
        res.end(readFileSync(path))
      })
    },
  }
}

/** The app's Tailwind utilities plus the kit's and Tailwind's preflight (the desktop has it), as /harness.css. */
async function harnessCss(): Promise<string> {
  const appDir = join(root, 'apps/cad')
  const source =
    "@import 'tailwindcss/preflight.css' layer(base);\n" +
    appCssSource({
      appDir,
      sources: [join(root, 'apps/cad/src'), join(root, 'vendor/imbatranim-ui/src')],
      themeCss: readKitSnapshot(join(root, 'vendor/imbatranim-ui')).themeCss,
    })
  const compiler = await compile(source, { base: appDir, onDependency: () => {} })
  const sources = compiler.sources.map((s) => ({ ...s, negated: false }))
  const candidates = new Scanner({ sources }).scan()
  return optimize(compiler.build(candidates), { file: 'harness.css' }).code
}

function styles(): Plugin {
  return {
    name: 'cad-harness:styles',
    configureServer(server) {
      server.middlewares.use('/harness.css', (_req, res) => {
        harnessCss().then(
          (css) => {
            res.setHeader('content-type', 'text/css')
            res.end(readFileSync(join(root, 'apps/cad/harness/desktop.css'), 'utf8') + css)
          },
          (err: unknown) => {
            res.statusCode = 500
            res.end(String(err))
          }
        )
      })
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [fixtures(), styles()],
  resolve: {
    alias: [
      {
        find: /^@imbatranim\/ui$/,
        replacement: join(root, 'vendor/imbatranim-ui/src/index.ts'),
      },
    ],
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  server: { fs: { allow: [root] } },
})
