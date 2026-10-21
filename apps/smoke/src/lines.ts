const NEWLINE = 0x0a

/** Lines in a text file: newline count, plus one for a last line with no newline after it. */
export function countLines(bytes: Uint8Array): number {
  let lines = 0
  for (const byte of bytes) if (byte === NEWLINE) lines++
  return bytes.length > 0 && bytes[bytes.length - 1] !== NEWLINE ? lines + 1 : lines
}
