import { existsSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { getWebUiHome } from '../../../studio/public/config'
import { libraryAvatar } from '../../../studio/public/avatar-library'

export interface AppProfileAvatar {
  type: 'generated' | 'image' | 'library'
  seed?: string
  url?: string
  assetId?: string
  revision?: number
  updatedAt?: number
}

export async function readAppProfileAvatar(name: string): Promise<AppProfileAvatar | null> {
  const dir = join(getWebUiHome(), 'profile-metadata', Buffer.from(name || 'default', 'utf8').toString('base64url'))
  const path = join(dir, 'avatar.json')
  if (!existsSync(path)) return null
  try {
    const meta = JSON.parse(readFileSync(path, 'utf8'))
    if (meta.type === 'library') return libraryAvatar(meta.assetId, meta.revision, meta.updatedAt)
    if (meta.type === 'generated') return { type: 'generated', seed: typeof meta.seed === 'string' ? meta.seed : name, updatedAt: meta.updatedAt }
    if (meta.type === 'image' && meta.file === 'avatar.bin' && /^image\/(png|jpeg|webp)$/.test(meta.mime)) {
      const imagePath = join(dir, 'avatar.bin')
      if (!existsSync(imagePath)) return null
      const hash = createHash('sha256').update(readFileSync(imagePath)).digest('hex')
      return { type: 'image', url: `/api/hermes/profiles/${encodeURIComponent(name)}/avatar/image/${hash}`, updatedAt: meta.updatedAt }
    }
  } catch { /* A corrupt or missing avatar safely falls back to the default. */ }
  return null
}