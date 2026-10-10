import { describe, expect, it } from 'vitest'
import { libraryAssetIds, libraryAssetPath, libraryAvatar } from '../../packages/server/src/modules/studio/services/avatars/library'

// Manifest routes are intentionally exact; a valid-looking but unlisted hash is not served.
describe('avatar library r3', () => {
  it('exposes exactly 50 distinct versioned public URLs and small references', () => {
    expect(libraryAssetIds).toHaveLength(50)
    expect(new Set(libraryAssetIds).size).toBe(50)
    for (const id of libraryAssetIds) {
      const ref = libraryAvatar(id, 3)
      expect(ref).toMatchObject({ type: 'library', assetId: id, revision: 3 })
      expect(ref?.url).toMatch(/^\/avatar-library\/r3\/ip-\d{3}\.[a-f0-9]{64}\.webp$/)
      expect(libraryAssetPath(ref!.url)).toBe(ref!.url.slice(1))
      expect(JSON.stringify(ref).length).toBeLessThan(200)
    }
  })
  it('rejects unknown versions, paths, hashes and unsafe segments', () => {
    for (const id of ['ip-000', 'ip-051', '../ip-001', 'ip-001/../../other', 'ip-001.webp']) {
      expect(libraryAvatar(id, 3)).toBeNull()
    }
    expect(libraryAvatar('ip-001', 1)).toBeNull()
    expect(libraryAssetPath('/avatar-library/r3/ip-001.' + '0'.repeat(64) + '.webp')).toBeNull()
    expect(libraryAssetPath('/avatar-library/r3/../secrets')).toBeNull()
    expect(libraryAssetPath('/avatar-library/r1/ip-001.webp')).toBeNull()
    expect(libraryAssetPath('/avatar-library/r2/ip-001.webp')).toBeNull()
  })
})
