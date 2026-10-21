/** The deck drops trailing blank lines from notes; drafts compare the same way. */
export function normalizeNotes(text: string): string {
  const lines = text.split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.join('\n')
}
