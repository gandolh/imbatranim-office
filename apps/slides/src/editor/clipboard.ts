/**
 * The shape clipboard. Module-level on purpose: every Slides window on the
 * desktop runs in the same page, so a copy in one window pastes in another
 * (with its pictures, which travel as bytes in the clip).
 */
import type { Clip } from '../engine/edits'

let clip: { clip: Clip; part: string; pastes: number } | null = null

export function setClip(next: Clip | null, part: string): void {
  clip = next ? { clip: next, part, pastes: 0 } : null
}

/** The clip to paste and how far to offset it (each paste onto its own slide steps further). */
export function takeClip(deck: object, part: string): { clip: Clip; offset: number } | null {
  if (!clip) return null
  const sameSlide = clip.clip.deckKey === deck && clip.part === part
  if (sameSlide) clip.pastes++
  return { clip: clip.clip, offset: sameSlide ? clip.pastes * 182880 : 0 }
}

export function hasClip(): boolean {
  return clip !== null
}
