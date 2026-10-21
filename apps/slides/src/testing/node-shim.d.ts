/*
 * The two node functions the tests' fixture loader uses (testing/fixtures.ts).
 * The app's tsconfig carries browser types only, and the tests run under
 * vitest, which provides node and __dirname.
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare const __dirname: string
