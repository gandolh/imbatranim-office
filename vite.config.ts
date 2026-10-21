// `npm run build:os`: the build the OS's marketplace runs after `npm ci`.
// Everything it does is in packages/shared/src/build/osBuild.ts.
import { defineConfig } from 'vite'
import { osBuildConfig } from './packages/shared/src/build/index.ts'

export default defineConfig(osBuildConfig({ root: import.meta.dirname }))
