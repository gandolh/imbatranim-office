/**
 * npm run kit:sync -- <os-checkout> <commit> [--check]
 *
 * Copies imbatranimOS's packages/ui/src at <commit> into vendor/imbatranim-ui/src
 * from git objects (the checkout's working tree is never read), rewrites
 * vendor/imbatranim-ui/COMMIT, and moves the shared-module pins in package.json
 * to what the OS's lockfile resolves at that commit. --check writes nothing and
 * exits 1 if the snapshot, COMMIT or a pin differs from the commit.
 */
import { join, resolve } from 'node:path'
import { syncKit } from '../packages/shared/src/build/kitSnapshot.ts'

const args = process.argv.slice(2)
const check = args.includes('--check')
const positional = args.filter((a) => a !== '--check')
if (positional.length !== 2) {
  console.error('usage: npm run kit:sync -- <os-checkout> <commit> [--check]')
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const [osDir, commit] = positional
try {
  const result = syncKit({
    osDir: resolve(osDir),
    commit,
    vendorDir: join(root, 'vendor', 'imbatranim-ui'),
    packageJson: join(root, 'package.json'),
    check,
  })
  const version = result.sharedKitVersion ?? 'absent'
  console.log(
    `kit:sync: ${result.commit}: ${result.files} files, SHARED_KIT_VERSION=${version}, theme=${result.theme}`
  )
  if (check) {
    const problems = [
      ...result.differences,
      ...result.pinChanges.map(
        (p) => `pin ${p.name}: package.json has ${p.from ?? 'none'}, the OS resolves ${p.to}`
      ),
    ]
    if (problems.length === 0) {
      console.log(
        'kit:sync --check: the snapshot, COMMIT and pins match the commit, byte for byte.'
      )
    } else {
      for (const p of problems) console.log(`  ${p}`)
      process.exit(1)
    }
  } else {
    if (result.differences.length === 0)
      console.log('kit:sync: the snapshot was already this commit.')
    else console.log(`kit:sync: wrote the snapshot (${result.differences.length} paths changed).`)
    for (const p of result.pinChanges)
      console.log(`  pin ${p.name}: ${p.from ?? 'none'} -> ${p.to}`)
    if (result.pinChanges.length > 0)
      console.log('kit:sync: pins moved; run npm install to update the lockfile.')
    if (result.sharedKitVersion === null) {
      console.log(
        'kit:sync: the kit has no SHARED_KIT_VERSION at this commit (provisional snapshot).'
      )
    }
  }
} catch (err) {
  console.error(`kit:sync: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
