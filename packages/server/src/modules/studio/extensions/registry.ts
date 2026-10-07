import Router from '@koa/router'

export interface ExtensionDescriptor {
  id: string
  version: string
  apiBase: string
  capabilities: string[]
}
export interface ServerExtensionSpec extends ExtensionDescriptor {
  contractVersion: 1
  initialize(): { routes: Router; dispose?: () => void }
}
export interface ServerExtensionRegistry {
  descriptors: ExtensionDescriptor[]
  failures: string[]
  routes: Router[]
  discovery: Router
}

// Host-owned registration boundary. Disabled/failed modules cannot install routes.
export function createServerExtensionRegistry(specs: ServerExtensionSpec[], enabled: readonly string[]): ServerExtensionRegistry {
  const descriptors: ExtensionDescriptor[] = []
  const routes: Router[] = []
  const failures: string[] = []
  const seen = new Set<string>()
  for (const spec of specs) {
    if (seen.has(spec.id)) { failures.push(spec.id); continue }
    seen.add(spec.id)
    if (!enabled.includes(spec.id)) continue
    let dispose: (() => void) | undefined
    try {
      if (!/^[a-z]+(?:-[a-z]+)*$/.test(spec.id) || spec.contractVersion !== 1 ||
        !/^\d+\.\d+\.\d+$/.test(spec.version) ||
        spec.apiBase !== `/api/studio/${spec.id}` || !spec.capabilities.length ||
        spec.capabilities.some(capability => !/^[a-z]+(?:-[a-z]+)*$/.test(capability))) throw new Error('Invalid extension contract')
      const active = spec.initialize()
      dispose = active.dispose
      if (!active.routes.stack.length || active.routes.stack.some(layer =>
        typeof layer.path !== 'string' || !layer.path.startsWith(`${spec.apiBase}/`) || layer.path.includes('*') ||
        layer.methods.some(method => !['HEAD', 'GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'].includes(method)))) {
        throw new Error('Extension route escaped its namespace')
      }
      routes.push(active.routes)
      descriptors.push({ id: spec.id, version: spec.version, apiBase: spec.apiBase, capabilities: [...spec.capabilities] })
    } catch {
      dispose?.()
      failures.push(spec.id)
    }
  }
  const discovery = new Router()
  discovery.get('/api/studio/extensions', ctx => { ctx.body = { contractVersion: 1, extensions: descriptors } })
  return { descriptors, failures, routes, discovery }
}
