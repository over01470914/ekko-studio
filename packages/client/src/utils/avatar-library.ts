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
const selectedImages = new Map<string, Promise<string>>()
let lastPicked: string | undefined

// Compatibility with the incumbent image-only API: fetch only the selected icon.
// Persist 128px WebP rather than requiring a server/Bridge restart for library refs.
export async function libraryAvatarImage(avatar: LibraryAvatar, baseUrl = '') {
  const resolved = resolveLibraryAvatar(avatar)
  if (!resolved?.url) throw new Error('Invalid library avatar')
  const url = `${baseUrl.replace(/\/$/, '')}${resolved.url}`
  let image = selectedImages.get(url)
  if (!image) {
    image = fetch(url, { cache: 'force-cache' }).then(async response => {
      if (!response.ok) throw new Error('Avatar image unavailable')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > 16384) throw new Error('Avatar image exceeds size limit')
      return `data:image/webp;base64,${btoa(String.fromCharCode(...bytes))}`
    }).catch(error => { selectedImages.delete(url); throw error })
    selectedImages.set(url, image)
  }
  return { type: 'image' as const, dataUrl: await image, assetId: avatar.assetId, revision: 3 }
}

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
  const candidates = libraryAssetIds.filter(id => id !== (current || lastPicked))
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  lastPicked = candidates[values[0] % candidates.length]
  return resolveLibraryAvatar({ type: 'library', assetId: lastPicked, revision: 3 })!
}
