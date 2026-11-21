import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultLoadMermaid } from '../src/mermaid.ts'

describe('mermaid integrity verification', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).mermaid
    vi.restoreAllMocks()
  })

  it('rejects execution and throws integrity error when remote script is tampered by 1 character', async () => {
    const validCode = await readFile(
      resolve(process.cwd(), 'node_modules/mermaid/dist/mermaid.min.js'),
      'utf8',
    )
    const tamperedCode = `${validCode.slice(0, -1)}${validCode.endsWith(';') ? ' ' : ';'}`

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => tamperedCode,
      })),
    )

    await expect(defaultLoadMermaid()).rejects.toThrow(/完整性校验失败/)
    expect((globalThis as Record<string, unknown>).mermaid).toBeUndefined()
  })
})
