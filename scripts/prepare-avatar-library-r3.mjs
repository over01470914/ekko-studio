import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import sharp from 'sharp'

const source = process.argv[2]
if (!source) throw new Error('Provide supplied library-r3 directory')
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
if (manifest.revision !== 3 || manifest.records.length !== 50) throw new Error('Unexpected library revision/count')
const hashes = {}
const sizes = []
for (const [index, record] of manifest.records.entries()) {
  const id = `ip-${String(index + 1).padStart(3, '0')}`
  if (record.id !== id || record.dimensions.join(',') !== '128,128' || record.encoding !== 'lossless WebP' || record.pixel_roundtrip_exact !== true) throw new Error(`Invalid record ${id}`)
  const bytes = readFileSync(join(source, 'icons', `${id}.webp`))
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== record.sha256 || bytes.length !== record.bytes || bytes.length > 15000 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.toString('ascii', 12, 16) !== 'VP8L') throw new Error(`Invalid icon ${id}`)
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (decoded.info.width !== 128 || decoded.info.height !== 128 || decoded.info.channels !== 4) throw new Error(`Invalid decoded dimensions ${id}`)

  hashes[id] = digest
  sizes.push(bytes.length)
  const dest = join('packages/client/public/avatar-library/r3', `${id}.${digest}.webp`)
  mkdirSync(join('packages/client/public/avatar-library/r3'), { recursive: true })
  copyFileSync(join(source, 'icons', `${id}.webp`), dest)
}
if (new Set(Object.values(hashes)).size !== 50) throw new Error('Duplicate icons')
for (const dest of ['packages/client/src/utils/avatar-library-r3.json', 'packages/server/src/modules/studio/services/avatars/library-r3.json']) {
  mkdirSync(join(dest, '..'), { recursive: true })
  writeFileSync(dest, `${JSON.stringify(hashes, null, 2)}\n`)
}
console.log(JSON.stringify({ count: sizes.length, total: sizes.reduce((a, b) => a + b, 0), min: Math.min(...sizes), max: Math.max(...sizes) }))
