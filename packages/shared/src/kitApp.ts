import type { ComponentType } from 'react'
import type { KitAppProps } from '@imbatranim/ui'

// The kit's own types (OS brief 163, `packages/ui/src/sharedKit.ts`), re-exported
// so an app imports everything about its module from one place. Nothing is
// mirrored: a kit:sync that changes them changes them here.
export type { KitAppProps, NativeHostContext } from '@imbatranim/ui'

/** What `apps/<name>/src/App.tsx` exports as `App`. */
export type KitApp = ComponentType<KitAppProps>
