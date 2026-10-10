import { join } from 'node:path'
export function getPersonalLabIdentity(appData: string) {
  const home = join(appData, 'ekko-personal-lab')
  return { name: 'Ekko Personal Lab', appId: 'com.ekko.personal-lab', packageName: 'ekko-personal-lab', version: '0.7.31-personal.1', channel: 'personal-lab', port: 4362, home, userData: join(home, 'desktop') } as const
}
export function trustedPersonalRenderer(value: string): boolean {
  try { const url = new URL(value); return url.origin === 'http://127.0.0.1:4362' && !url.username && !url.password && ['/', '/personal.html'].includes(url.pathname) }
  catch { return false }
}
