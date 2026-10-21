import { describe, expect, it } from 'vitest'
import { PageRender, readerPlatform } from './pdfjs'

describe('readerPlatform', () => {
  it("hands the engine the reader's own renderer for the bytes it opened, and a fresh one for any others", () => {
    const opened = new Uint8Array([1, 2, 3])
    const first = new PageRender(opened)
    const platform = readerPlatform(first)
    expect(platform.name).toBe('browser')
    // doc.render over the opened bytes is the document already drawn: no second parse.
    expect(platform.createRender(opened)).toBe(first)
    // After a save the engine holds new bytes: the reader must re-read them (the cache contract).
    const saved = new Uint8Array([1, 2, 3])
    const next = platform.createRender(saved)
    expect(next).not.toBe(first)
    expect(next).toBeInstanceOf(PageRender)
    expect((next as PageRender).bytes).toBe(saved)
  })
})
