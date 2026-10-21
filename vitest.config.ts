import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests run against the real React and the kit snapshot (the build keeps both
// external; see packages/shared/src/build/sharedKit.ts). Node by default; a test
// that needs a DOM opts in per file with `// @vitest-environment jsdom`, as in
// the OS. The kit's own tests in vendor/ are the OS's, never run here.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@imbatranim\/ui$/,
        replacement: fileURLToPath(new URL('./vendor/imbatranim-ui/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
  },
})
