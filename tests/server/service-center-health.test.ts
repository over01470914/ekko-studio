import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'

const sample = (id: string, healthUrl: string) => ({ id, name: 'Test', description: '', url: 'https://example.org/', icon: 'globe', category: 'Tests', tags: [], network: 'local' as const, enabled: true, sortOrder: 0, healthUrl, healthCheckEnabled: true })

describe('Service Center bounded health checks', () => {
  let server: Server
  let home: string
  let port: number
  let requests: Array<{ path: string; headers: Record<string, unknown> }>
  let repository: typeof import('../../packages/server/src/modules/studio/extensions/service-center/catalog')
  let health: typeof import('../../packages/server/src/modules/studio/extensions/service-center/health')
  beforeEach(async () => {
    home = await mkdtemp(join(process.env.TMPDIR || '/tmp/', 'service-health-test-'))
    vi.stubEnv('HERMES_WEB_UI_HOME', home)
    vi.resetModules()
    requests = []
    server = createServer((req, res) => {
      requests.push({ path: req.url || '', headers: req.headers })
      if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }); res.end(); return }
      if (req.url === '/large') { res.writeHead(200); res.end(Buffer.alloc(65_536)); return }
      if (req.url === '/slow') { res.writeHead(200); res.write('start'); return }
      res.writeHead(204); res.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
    const { installServiceCenterHost } = await import('../../packages/server/src/modules/studio/extensions/service-center/host')
    installServiceCenterHost({ dataRoot: join(home, 'service-center'), actorFor: () => ({ id: 1, role: 'super_admin' }), eligibleAdmin: () => false })
    repository = await import('../../packages/server/src/modules/studio/extensions/service-center/catalog')
    health = await import('../../packages/server/src/modules/studio/extensions/service-center/health')
  })
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.doUnmock('dns/promises')
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })
  it('rejects metadata, link-local, reserved and malformed destinations while allowing approved private routes', async () => {
    for (const host of ['169.254.169.254', '168.63.129.16', '100.100.100.200', '0.0.0.0', '198.18.0.1', '[fe80::1]', '[fd00:ec2::254]', '127.000.000.001']) {
      await expect(health.resolveHealthTarget(`http://${host}/`)).rejects.toThrow()
    }
    expect((await health.resolveHealthTarget(`http://127.0.0.1:${port}/`)).address).toBe('127.0.0.1')
    expect(health.safeIp('100.101.102.103')).toBe(true)
  })
  it('requires separate approval and sends no bearer, cookie or caller-supplied URL', async () => {
    const target = sample('approved', `http://127.0.0.1:${port}/ok`)
    await repository.saveService(0, target)
    expect((await health.healthFor(target, true)).state).toBe('unapproved')
    expect(requests).toHaveLength(0)
    await repository.approveHealth(target.id, target.healthUrl, true)
    const result = await health.healthFor(target, true)
    expect(result.state).toBe('healthy')
    expect(result.status).toBe(204)
    expect(result.checkedAt).toBeTruthy()
    expect(requests).toHaveLength(1)
    expect(requests[0].headers).not.toHaveProperty('authorization')
    expect(requests[0].headers).not.toHaveProperty('cookie')
    expect(JSON.stringify(result)).not.toContain('127.0.0.1')
    await repository.saveService(1, { ...target, healthUrl: `http://127.0.0.1:${port}/changed` })
    await repository.saveService(2, target)
    expect((await health.healthFor(target, true)).state).toBe('unapproved')
  })
  it('rejects a hostname with a mixed safe and metadata DNS answer', async () => {
    vi.doMock('dns/promises', () => ({ lookup: vi.fn(async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]) }))
    vi.resetModules()
    const withDns = await import('../../packages/server/src/modules/studio/extensions/service-center/health')
    await expect(withDns.resolveHealthTarget('http://mixed.example.org/health')).rejects.toThrow('Unsafe health destination')
    expect(requests).toHaveLength(0)
  })
  it('does not follow redirects, bounds response bodies and enforces absolute timeout', async () => {
    for (const path of ['redirect', 'large', 'slow']) {
      const target = sample(path, `http://127.0.0.1:${port}/${path}`)
      const current = await repository.catalog()
      await repository.saveService(current.revision, target)
      await repository.approveHealth(target.id, target.healthUrl, true)
      const result = await health.healthFor(target, true)
      expect(result.state).toBe(path === 'redirect' ? 'redirected' : path === 'large' ? 'healthy' : 'timeout')
      expect(JSON.stringify(result)).not.toContain('meta-data')
    }
    expect(requests.map(request => request.path)).toEqual(['/redirect', '/large', '/slow'])
  }, 10_000)
})