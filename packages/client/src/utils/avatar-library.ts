import hashes from './avatar-library-r3.json'

export interface LibraryAvatar {
  type: 'library'
  assetId: string
  revision: 3
  url?: string
  updatedAt?: number
}
const libraryHashes: Record<string, string> = hashes
export const libraryAssetIds = Object.keys(libraryHashes)

export function resolveLibraryAvatar(value: unknown): LibraryAvatar | null {
  if (!value || typeof value !== 'object') return null
  const avatar = value as Partial<LibraryAvatar>
  if (avatar.revision !== 3 || typeof avatar.assetId !== 'string' || !Object.hasOwn(libraryHashes, avatar.assetId)) return null
  return {
    type: 'library', assetId: avatar.assetId, revision: 3,
    url: `/avatar-library/r3/${avatar.assetId}.${libraryHashes[avatar.assetId]}.webp`,
    updatedAt: avatar.updatedAt,
  }
}

export function pickLibraryAvatar(current?: string): LibraryAvatar {
  const candidates = libraryAssetIds.filter(id => id !== current)
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return resolveLibraryAvatar({ type: 'library', assetId: candidates[values[0] % candidates.length], revision: 3 })!
}
