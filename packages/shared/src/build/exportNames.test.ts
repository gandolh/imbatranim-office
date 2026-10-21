import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { kitExports, reactExports } from './exportNames.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'imbatranim-export-names-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('reactExports', () => {
  it("reads the production build's names, which the desktop lends", () => {
    const names = reactExports(repoRoot)
    expect(names.react.names).toEqual(
      expect.arrayContaining(['useState', 'createContext', 'Fragment'])
    )
    // Development-only exports are not on the desktop's production namespace.
    expect(names.react.names).not.toContain('act')
    expect(names.react.names).not.toContain('captureOwnerStack')
    expect(names['react/jsx-runtime'].names).toEqual(['Fragment', 'jsx', 'jsxs'])
    expect(names['react-dom/client'].names).toEqual(['createRoot', 'hydrateRoot', 'version'])
    expect(names['react-dom'].names).toContain('createPortal')
    expect(Object.values(names).every((m) => m.hasDefault)).toBe(true)
  })
})

describe('kitExports', () => {
  it("lists the snapshot's value exports and none of its types", () => {
    const kit = kitExports(join(repoRoot, 'vendor/imbatranim-ui/src/index.ts'))
    expect(kit.names).toEqual(
      expect.arrayContaining([
        'Button',
        'ConfirmDialog',
        'useConfirm',
        'useSystem',
        'SystemProvider',
        'useOpenIntent',
        'saveOverRead',
        'describeFileFailure',
        'fileName',
        'PROTOCOL_VERSION',
        'queryClient',
      ])
    )
    for (const type of [
      'SystemHandle',
      'FileConflictDialogProps',
      'VirtualList',
      'OpenedFile',
      'LogEntry',
    ]) {
      expect(kit.names).not.toContain(type)
    }
    expect(kit.hasDefault).toBe(false)
  })

  it('follows export * from relative modules and reads declarations', () => {
    const dir = join(scratch, 'kit')
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(
      join(dir, 'index.ts'),
      [
        "export * from './lib'",
        "export * as tools from './lib/tools'",
        'export const SHARED_KIT_VERSION = 1',
        'export function hello() {}',
        'export class Box {}',
        'export enum Mode { A }',
        'export type Kind = string',
        'export interface Shape { x: number }',
        'export default function main() {}',
        '',
      ].join('\n')
    )
    writeFileSync(
      join(dir, 'lib', 'index.ts'),
      "export { a, type B } from './tools'\nexport default 1\n"
    )
    writeFileSync(join(dir, 'lib', 'tools.ts'), 'export const a = 1\nexport type B = number\n')
    expect(kitExports(join(dir, 'index.ts'))).toEqual({
      names: ['Box', 'Mode', 'SHARED_KIT_VERSION', 'a', 'hello', 'tools'],
      hasDefault: true,
    })
  })
})
