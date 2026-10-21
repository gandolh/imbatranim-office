import { describe, expect, it, vi } from 'vitest'
import { FileConflictError } from './files'
import { saveOverRead } from './saveOverRead'

const target = { root: 'home', path: 'Docs/plan.xlsx', name: 'plan.xlsx' }
const bytes = new Uint8Array([1, 2, 3])

describe('saveOverRead', () => {
  it('sends the version it read and returns the new one', async () => {
    const upload = vi.fn().mockResolvedValue({ version: 'v2' })
    const ask = vi.fn()
    await expect(saveOverRead({ upload }, target, bytes, 'v1', ask)).resolves.toEqual({
      outcome: 'saved',
      version: 'v2',
    })
    expect(upload).toHaveBeenCalledWith('home', 'Docs/plan.xlsx', bytes, 'plan.xlsx', {
      expected: 'v1',
    })
    expect(ask).not.toHaveBeenCalled()
  })

  it('writes unconditionally when the read had no version', async () => {
    const upload = vi.fn().mockResolvedValue({ version: null })
    await saveOverRead({ upload }, target, bytes, null, vi.fn())
    expect(upload).toHaveBeenCalledWith('home', 'Docs/plan.xlsx', bytes, 'plan.xlsx', {
      expected: undefined,
    })
  })

  it('asks on a conflict, and Overwrite writes again with no precondition', async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new FileConflictError('v9'))
      .mockResolvedValueOnce({ version: 'v10' })
    const ask = vi.fn().mockResolvedValue('overwrite')
    await expect(saveOverRead({ upload }, target, bytes, 'v1', ask)).resolves.toEqual({
      outcome: 'saved',
      version: 'v10',
    })
    expect(ask).toHaveBeenCalledWith('plan.xlsx')
    expect(upload).toHaveBeenLastCalledWith('home', 'Docs/plan.xlsx', bytes, 'plan.xlsx')
  })

  it.each(['reload', 'cancel'] as const)('returns %s and writes nothing more', async (choice) => {
    const upload = vi.fn().mockRejectedValueOnce(new FileConflictError(null))
    const ask = vi.fn().mockResolvedValue(choice)
    await expect(saveOverRead({ upload }, target, bytes, 'v1', ask)).resolves.toEqual({
      outcome: choice,
    })
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('throws any other failure without asking', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('disk full'))
    const ask = vi.fn()
    await expect(saveOverRead({ upload }, target, bytes, 'v1', ask)).rejects.toThrow('disk full')
    expect(ask).not.toHaveBeenCalled()
  })
})
