import { describe, it, expect, vi, afterEach } from 'vitest'

import { libraryAvatarImage, resolveLibraryAvatar } from '../../packages/client/src/utils/avatar-library'

afterEach(() => vi.unstubAllGlobals())

describe('incumbent image API compatibility', () => {
  it('loads only a selected asset and reuses its cached bytes', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([82, 73, 70, 70]).buffer })
    vi.stubGlobal('fetch', fetcher)
    expect(fetcher).not.toHaveBeenCalled()
    const avatar = resolveLibraryAvatar({ type: 'library', revision: 3, assetId: 'ip-047' })!
    const first = await libraryAvatarImage(avatar, 'http://localhost:8648')
    const second = await libraryAvatarImage(avatar, 'http://localhost:8648')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(`http://localhost:8648${avatar.url}`, { cache: 'force-cache' })
    expect(first).toEqual(second)
    expect(first.type).toBe('image')
    expect(first.dataUrl).toBe('data:image/webp;base64,UklGRg==')
  })
  it('rejects unknown IDs without fetching', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(libraryAvatarImage({ type: 'library', revision: 3, assetId: '../outside' })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array(16385).buffer }))
    await expect(libraryAvatarImage({ type: 'library', revision: 3, assetId: 'ip-048' })).rejects.toThrow('size limit')
  })
})
