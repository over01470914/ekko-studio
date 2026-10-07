// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createClientExtensionRegistry, extensionNavigation, type ClientExtensionHost, type ClientExtensionSpec } from '../../packages/client/src/modules/studio-extensions/registry'

const descriptor = { id: 'service-center', version: '1.0.0', apiBase: '/api/studio/service-center', capabilities: ['directory'] }
const reply = (extensions: unknown[] = [descriptor]) => ({ contractVersion: 1, extensions })
const spec = (initialize: ClientExtensionSpec['initialize']): ClientExtensionSpec => ({
  id: 'service-center', version: '1.0.0', capabilities: ['directory'], initialize,
})
const make = () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  const locale = ref('en')
  let session = true
  let invalidate = () => {}
  let result: unknown = reply()
  const request = vi.fn(async () => result)
  const host: ClientExtensionHost = {
    request: <T>(path: string) => request(path) as Promise<T>,
    managedUsers: async () => ({ users: [] }),
    hasSession: () => session, onAuthInvalidated: callback => { invalidate = callback; return () => { invalidate = () => {} } },
    locale, theme: ref('light'),
  }
  const initialize = vi.fn(() => ({ route: { path: '/service-center', name: 'studio.serviceCenter', component: { render: () => null } },
    navigation: (tag: string) => ({ key: 'serviceCenter', route: 'studio.serviceCenter', label: `Service ${tag}`, path: 'M0 0' }),
    dispose: vi.fn(),
  }))
  return { router, locale, request, host, initialize, setResult: (value: unknown) => { result = value },
    logout: () => { session = false; invalidate() }, invalidate: () => invalidate() }
}

describe('Studio client extension registration', () => {
  it('omits a disabled or unknown server module and its route/navigation', async () => {
    const fixture = make()
    fixture.setResult(reply([]))
    const registry = createClientExtensionRegistry(fixture.router, fixture.host, [spec(fixture.initialize)])
    await registry.ensure()
    expect(fixture.initialize).not.toHaveBeenCalled()
    expect(fixture.router.hasRoute('studio.serviceCenter')).toBe(false)
    expect(extensionNavigation.value).toEqual([])
    registry.dispose()
  })
  it('registers advertised capabilities and resets route, state and navigation on identity invalidation', async () => {
    const fixture = make()
    const registry = createClientExtensionRegistry(fixture.router, fixture.host, [spec(fixture.initialize)])
    await registry.ensure()
    expect(fixture.router.hasRoute('studio.serviceCenter')).toBe(true)
    expect(extensionNavigation.value[0].label).toBe('Service en')
    fixture.locale.value = 'zh-TW'
    registry.refreshNavigation()
    expect(extensionNavigation.value[0].label).toBe('Service zh-TW')
    fixture.logout()
    expect(fixture.router.hasRoute('studio.serviceCenter')).toBe(false)
    expect(extensionNavigation.value).toEqual([])
    expect(fixture.initialize.mock.results[0].value.dispose).toHaveBeenCalledOnce()
    registry.dispose()
  })
  it('ignores incompatible versions and rolls back failed module initialization', async () => {
    const fixture = make()
    fixture.setResult(reply([{ ...descriptor, version: '2.0.0' }]))
    let registry = createClientExtensionRegistry(fixture.router, fixture.host, [spec(fixture.initialize)])
    await registry.ensure()
    expect(fixture.router.hasRoute('studio.serviceCenter')).toBe(false)
    registry.dispose()
    fixture.setResult(reply())
    const fail = vi.fn((): ReturnType<ClientExtensionSpec['initialize']> => { throw new Error('failed') })
    registry = createClientExtensionRegistry(fixture.router, fixture.host, [spec(fail)])
    await registry.ensure()
    expect(fixture.router.hasRoute('studio.serviceCenter')).toBe(false)
    expect(extensionNavigation.value).toEqual([])
    registry.dispose()
  })
  it('does not resurrect an old user route when discovery resolves after logout', async () => {
    const fixture = make()
    let finish!: (value: unknown) => void
    fixture.host.request = <T>() => new Promise<unknown>(resolve => { finish = resolve }) as Promise<T>
    const registry = createClientExtensionRegistry(fixture.router, fixture.host, [spec(fixture.initialize)])
    const pending = registry.ensure()
    fixture.logout()
    finish(reply())
    await pending
    expect(fixture.router.hasRoute('studio.serviceCenter')).toBe(false)
    expect(extensionNavigation.value).toEqual([])
    registry.dispose()
  })
  it('refuses an existing built-in path even if its route name differs', async () => {
    const fixture = make()
    fixture.router.addRoute({ path: '/service-center', name: 'studio.builtIn', component: { render: () => null } })
    const registry = createClientExtensionRegistry(fixture.router, fixture.host, [spec(fixture.initialize)])
    await registry.ensure()
    expect(fixture.router.hasRoute('studio.builtIn')).toBe(true)
    expect(fixture.router.hasRoute('studio.serviceCenter')).toBe(false)
    expect(extensionNavigation.value).toEqual([])
    expect(fixture.initialize.mock.results[0].value.dispose).toHaveBeenCalledOnce()
    registry.dispose()
  })
})
