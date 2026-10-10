import hashes from './library-r3.json'

export const LIBRARY_REVISION = 3 as const
export type LibraryAvatar = { type: 'library'; assetId: string; revision: 3; url: string; updatedAt?: number }
const libraryHashes: Record<string, string> = hashes
export const libraryAssetIds = Object.keys(libraryHashes)

export function libraryAvatar(assetId: unknown, revision: unknown, updatedAt?: number): LibraryAvatar | null {
  if (revision !== LIBRARY_REVISION || typeof assetId !== 'string' || !Object.hasOwn(libraryHashes, assetId)) return null
  return {
    type: 'library', assetId, revision: LIBRARY_REVISION,
    url: `/avatar-library/r3/${assetId}.${libraryHashes[assetId]}.webp`, updatedAt,
  }
}

export function libraryAssetPath(path: string): string | null {
  const match = /^\/avatar-library\/r3\/(ip-\d{3})\.([a-f0-9]{64})\.webp$/.exec(path)
  if (!match || libraryHashes[match[1]] !== match[2]) return null
  return `avatar-library/r3/${match[1]}.${match[2]}.webp`
}
