import { describe, expect, it } from 'vitest'
import { getPersonalLabIdentity, trustedPersonalRenderer } from '../../packages/desktop/src/main/personal-lab-identity'
import { readFileSync } from 'node:fs'

describe('Personal Lab native identity', () => {
  it('separates package/appId/home/userData/lock/update channel while keeping the normal default entry intact', () => {
    const identity = getPersonalLabIdentity('/fixture/AppData')
    expect(identity).toMatchObject({ name: 'Ekko Personal Lab', appId: 'com.ekko.personal-lab', channel: 'personal-lab', port: 4362, version: '0.7.31-personal.1' })
    expect(identity.userData).toBe('/fixture/AppData/ekko-personal-lab/desktop')
    expect(identity.home).toBe('/fixture/AppData/ekko-personal-lab')
    const pkg = JSON.parse(readFileSync('packages/desktop/package.json', 'utf8'))
    expect(pkg.name).toBe('hermes-studio'); expect(pkg.version).toBe('0.7.31'); expect(pkg.main).toBe('dist/main/entry.js')
    expect(readFileSync('packages/desktop/src/main/entry.ts', 'utf8')).not.toContain('personal')
  })
  it('privileged preload trusts only the fixed local renderer and blocks remote HTML, credentials and navigation escapes', () => {
    for (const url of ['http://127.0.0.1:4362/', 'http://127.0.0.1:4362/personal.html#/personal-agent']) expect(trustedPersonalRenderer(url)).toBe(true)
    for (const url of ['https://central.test/', 'http://127.0.0.1:8648/', 'http://evil@127.0.0.1:4362/', 'http://127.0.0.1:4362/other.html', 'file:///secret']) expect(trustedPersonalRenderer(url)).toBe(false)
  })
})
