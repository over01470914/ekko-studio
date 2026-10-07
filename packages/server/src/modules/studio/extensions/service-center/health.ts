import { lookup } from 'dns/promises'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { isIP } from 'net'
import { ServiceCenterError, validateNavigationUrl, type ServiceEntry } from './manifest'
import { isHealthApproved } from './catalog'

export interface HealthResult {
  state: 'untested' | 'stale' | 'unapproved' | 'disabled' | 'healthy' | 'http_error' | 'redirected' | 'timeout' | 'unreachable' | 'blocked' | 'busy'
  checkedAt: string | null
  latencyMs: number | null
  status: number | null
}
const idle = (state: HealthResult['state']): HealthResult => ({ state, checkedAt: null, latencyMs: null, status: null })
const cache = new Map<string, { url: string; expires: number; result: HealthResult }>()
const running = new Set<string>()
const lastAttempt = new Map<string, number>()

export function safeIp(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (value.startsWith('::ffff:')) return safeIp(value.slice(7))
  const family = isIP(value)
  if (family === 4) {
    const [a, b, c, d] = value.split('.').map(Number)
    if (a === 0 || a >= 224 || (a === 169 && b === 254) ||
      (a === 168 && b === 63 && c === 129 && d === 16) || // Azure platform metadata/wire server
      (a === 100 && b === 100 && c === 100 && (d === 200 || d === 100)) ||
      (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19))) return false
    return true // loopback, RFC1918 and Tailscale CGNAT are allowed only after approval
  }
  if (family === 6) return value !== '::' && value !== '::1%0' && value !== 'fd00:ec2::254' &&
    !value.startsWith('fe80:') && !value.startsWith('ff') &&
    !value.startsWith('2001:db8:') && value !== '::ffff:0:0'
  return false
}
export async function resolveHealthTarget(raw: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  if (!validateNavigationUrl(raw)) throw new ServiceCenterError('Invalid health URL')
  const url = new URL(raw)
  if (url.port && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1)) throw new ServiceCenterError('Invalid health port')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  // Reject obfuscated and ambiguous IPv4 forms before a DNS lookup can normalize them.
  if (/^\d|^0x|\.localdomain$/i.test(hostname) && !isIP(hostname)) throw new ServiceCenterError('Unsafe health host')
  const results = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (!results.length || results.some(result => !safeIp(result.address))) throw new ServiceCenterError('Unsafe health destination')
  return { url, address: results[0].address, family: results[0].family as 4 | 6 }
}

async function fetchStatus(url: URL, address: string, family: 4 | 6): Promise<{ state: HealthResult['state']; status: number | null }> {
  return new Promise(resolve => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (state: HealthResult['state'], status: number | null = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ state, status })
    }
    const agent = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = agent(url, {
      method: 'GET', headers: { Accept: '*/*' },
      // Preserve TLS hostname validation/Host while pinning the prevalidated DNS result.
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      maxHeaderSize: 8192,
    }, response => {
      const status = response.statusCode || 0
      let bytes = 0
      const statusState = status >= 300 && status < 400 ? 'redirected' : status >= 200 && status < 300 ? 'healthy' : 'http_error'
      response.on('data', chunk => {
        bytes += (chunk as Buffer).length
        if (bytes > 8192) { finish(statusState, status); response.destroy() }
      })
      response.on('end', () => finish(statusState, status))
      response.on('error', () => finish(statusState, status))
    })
    timer = setTimeout(() => { req.destroy(); finish('timeout') }, 3500)
    req.on('error', () => finish('unreachable'))
    req.end()
  })
}

export async function healthFor(service: ServiceEntry, refresh = false): Promise<HealthResult> {
  if (!service.healthCheckEnabled || !service.healthUrl) return idle('disabled')
  if (!await isHealthApproved(service.id, service.healthUrl)) return idle('unapproved')
  const cached = cache.get(service.id)
  if (cached?.url === service.healthUrl && cached.expires > Date.now()) return cached.result
  if (!refresh) return cached?.url === service.healthUrl ? { ...cached.result, state: 'stale' } : idle('untested')
  if (running.size >= 3 || running.has(service.id) || Date.now() - (lastAttempt.get(service.id) || 0) < 10_000) return idle('busy')
  running.add(service.id)
  lastAttempt.set(service.id, Date.now())
  const started = Date.now()
  try {
    let result: { state: HealthResult['state']; status: number | null }
    try {
      const target = await Promise.race([
        resolveHealthTarget(service.healthUrl),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dns_timeout')), 3500)),
      ])
      result = await fetchStatus(target.url, target.address, target.family)
    } catch (error) {
      result = { state: error instanceof ServiceCenterError ? 'blocked' : (error as Error).message === 'dns_timeout' ? 'timeout' : 'unreachable', status: null }
    }
    const output: HealthResult = { ...result, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started }
    cache.set(service.id, { url: service.healthUrl, expires: Date.now() + 30_000, result: output })
    return output
  } finally { running.delete(service.id) }
}
