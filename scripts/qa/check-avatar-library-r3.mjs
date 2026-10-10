import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync('/Users/garbagod/.hermes/assets/ipaslogo/library-r3/manifest.json', 'utf8'))
const serverMap = JSON.parse(fs.readFileSync(path.join(root, 'packages/server/src/modules/studio/services/avatars/library-r3.json'), 'utf8'))
const clientMap = JSON.parse(fs.readFileSync(path.join(root, 'packages/client/src/utils/avatar-library-r3.json'), 'utf8'))
const files = fs.readdirSync(path.join(root, 'packages/client/public/avatar-library/r3'))
const errors = []
let bytes = 0, min = Infinity, max = 0
if (manifest.revision !== 3 || manifest.records.length !== 50) errors.push('manifest revision/count')
if (files.length !== 50) errors.push(`asset file count ${files.length}`)
for (const entry of manifest.records) {
  const file = `${entry.id}.${entry.sha256}.webp`
  const packaged = path.join(root, 'packages/client/public/avatar-library/r3', file)
  const source = entry.path
  for (const [label, p] of [['package', packaged], ['source', source]]) {
    const data = fs.readFileSync(p)
    const hash = crypto.createHash('sha256').update(data).digest('hex')
    const decoded = await sharp(data).metadata()
    if (hash !== entry.sha256) errors.push(`${entry.id} ${label} hash ${hash}`)
    if (data.length !== entry.bytes) errors.push(`${entry.id} ${label} byte count ${data.length}`)
    if (decoded.width !== 128 || decoded.height !== 128 || decoded.format !== 'webp') errors.push(`${entry.id} ${label} decode metadata ${JSON.stringify(decoded)}`)
    if (label === 'package') { bytes += data.length; min = Math.min(min, data.length); max = Math.max(max, data.length) }
  }
  if (serverMap[entry.id] !== entry.sha256 || clientMap[entry.id] !== entry.sha256) errors.push(`${entry.id} client/server map mismatch`)
  const base = await sharp(source).raw().toBuffer()
  const built = await sharp(packaged).raw().toBuffer()
  if (!base.equals(built)) errors.push(`${entry.id} decoded RGBA mismatch source/package`)
}
const preparationPath = '/Users/garbagod/.hermes/profiles/platform-engineer/cache/scratch/t_28fcf0a7/prepared-1791623418005762000/preparation.json'
const preparation = JSON.parse(fs.readFileSync(preparationPath, 'utf8'))
const candidateRoot = path.join(path.dirname(preparationPath), 'candidate-dist')
const candidateEntries = Object.entries(preparation.candidateHashes)
let candidateBytes = 0
for (const [relativePath, expectedHash] of candidateEntries) {
  const data = fs.readFileSync(path.join(candidateRoot, relativePath))
  const actualHash = crypto.createHash('sha256').update(data).digest('hex')
  candidateBytes += data.length
  if (actualHash !== expectedHash) errors.push(`candidate hash mismatch ${relativePath}`)
}
const candidateFileCount = fs.readdirSync(candidateRoot, { recursive: true }).filter(entry => fs.statSync(path.join(candidateRoot, entry)).isFile()).length
if (candidateEntries.length !== candidateFileCount) errors.push(`candidate file count mismatch ${candidateEntries.length}/${candidateFileCount}`)
if (preparation.sourceSha !== 'c62c8363684f0b76f61d883be7dad90ebc0ada6b' || preparation.remoteSha !== preparation.sourceSha) errors.push('candidate source/remote SHA mismatch')
console.log(JSON.stringify({revision: manifest.revision, records: manifest.records.length, packagedFiles: files.length, bytes, min, max, uniqueHashes: new Set(manifest.records.map(x => x.sha256)).size, decodeAndPixelComparisons: manifest.records.length, candidateFilesExpected: candidateEntries.length, candidateFilesObserved: candidateFileCount, candidateBytes, candidateSourceSha: preparation.sourceSha, candidateHashesVerified: candidateEntries.length, errors}, null, 2))
if (errors.length) process.exitCode = 1
