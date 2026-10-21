import { FileConflictError } from './files'
import type { SystemFs } from '../system'
import type { FileConflictChoice } from '../hooks/useFileConflict'

/** What a {@link saveOverRead} did. */
export type SaveOverReadOutcome =
  /** The bytes are on disk; `version` is the file's new token. */
  | { outcome: 'saved'; version: string | null }
  /** The file changed on disk and the user chose to load that copy instead. Nothing was written. */
  | { outcome: 'reload' }
  /** The file changed on disk and the user cancelled. Nothing was written. */
  | { outcome: 'cancel' }

/**
 * Save over the file an editor read, asking first if it changed on disk since
 * (brief 155). `expected` is the version token from that read; null or
 * undefined writes unconditionally, as a backend that sent no token requires.
 *
 * On a `FileConflictError` it asks through `ask` (from `useFileConflict`):
 * Overwrite writes again with no precondition, Reload and Cancel write nothing
 * and are returned for the caller to act on. Any other failure throws, as
 * `upload` does.
 */
export async function saveOverRead(
  fs: Pick<SystemFs, 'upload'>,
  target: { root: string; path: string; name: string },
  bytes: ArrayBuffer | Uint8Array,
  expected: string | null | undefined,
  ask: (name: string) => Promise<FileConflictChoice>
): Promise<SaveOverReadOutcome> {
  const { root, path, name } = target
  try {
    const written = await fs.upload(root, path, bytes, name, { expected: expected ?? undefined })
    return { outcome: 'saved', version: written.version }
  } catch (err) {
    if (!(err instanceof FileConflictError)) throw err
    const choice = await ask(name)
    if (choice !== 'overwrite') return { outcome: choice }
    const written = await fs.upload(root, path, bytes, name)
    return { outcome: 'saved', version: written.version }
  }
}
