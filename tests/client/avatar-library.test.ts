import { describe, expect, it } from 'vitest'
import { libraryAssetIds, pickLibraryAvatar, resolveLibraryAvatar } from '../../packages/client/src/utils/avatar-library'

describe('client avatar library', () => {
  it('resolves only known lightweight references, ignoring persisted URL spoofing', () => {
    expect(libraryAssetIds).toHaveLength(50)
    expect(resolveLibraryAvatar({ type: 'library', assetId: 'ip-012', revision: 3, url: 'https://attacker.invalid/' })?.url)
      .toMatch(/^\/avatar-library\/r3\/ip-012\.[a-f0-9]{64}\.webp$/)
    expect(resolveLibraryAvatar({ type: 'library', assetId: '../secrets', revision: 3 })).toBeNull()
    expect(resolveLibraryAvatar({ type: 'library', assetId: 'ip-012', revision: 1 })).toBeNull()
  })
  it('never immediately repeats the current ID and does not decode/preload icons', () => {
    for (const id of libraryAssetIds) {
      const chosen = pickLibraryAvatar(id)
      expect(chosen.assetId).not.toBe(id)
      expect(chosen.url).toMatch(/^\/avatar-library\/r3\//)
    }
  })
})
