/**
 * The reader context — how every part of the shell (and Part B's editor tools)
 * reaches the shared {@link ReaderController}. Provided once by Pdf.
 */
import { createContext, useContext } from 'react'
import type { ReaderController } from './types'

export const ReaderContext = createContext<ReaderController | null>(null)

/** Access the reader controller. Throws if used outside the provider. */
export function useReader(): ReaderController {
  const ctx = useContext(ReaderContext)
  if (!ctx) {
    throw new Error('useReader must be used within <ReaderContext.Provider>')
  }
  return ctx
}
