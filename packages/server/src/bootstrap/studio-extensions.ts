import type { Context } from 'koa'
import { join } from 'path'
import { config } from '../modules/studio/public/config'
import { findUserById } from '../modules/studio/repositories/users-store'
import { ServiceCenterError } from '../modules/studio/extensions/service-center/manifest'
import { serviceCenterExtension } from '../modules/studio/extensions/service-center'
import { createServerExtensionRegistry } from '../modules/studio/extensions/registry'
import { personalAgentExtension } from '../modules/studio/extensions/personal-agent'
import { loadPersonalAgentService } from '../modules/studio/extensions/personal-agent/service'

// This is the only adapter allowed to read private Studio account/config state.
export function studioExtensions() {
  const serviceCenter = serviceCenterExtension({
    dataRoot: join(config.appHome, 'service-center'),
    actorFor(ctx: Context) {
      const id = ctx.state.user?.id
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new ServiceCenterError('Active user required', 403)
      const user = findUserById(id)
      if (!user || user.status !== 'active' || !['admin', 'super_admin'].includes(user.role)) throw new ServiceCenterError('Active user required', 403)
      return { id: user.id, role: user.role as 'admin' | 'super_admin' }
    },
    eligibleAdmin(id: number) {
      const user = findUserById(id)
      return !!user && user.status === 'active' && user.role === 'admin'
    },
  })
  const personalAgent = personalAgentExtension({
    actorFor(ctx: Context) {
      const id = ctx.state.user?.id
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return null
      const user = findUserById(id)
      return user?.status === 'active' ? String(user.id) : null
    },
    createService: () => loadPersonalAgentService(join(config.appHome, 'personal-agent')),
  })
  const enabled = [
    ...(process.env.STUDIO_SERVICE_CENTER_ENABLED === '1' ? ['service-center'] : []),
    ...(process.env.STUDIO_PERSONAL_AGENT_ENABLED === '1' ? ['personal-agent'] : []),
  ]
  const registry = createServerExtensionRegistry([serviceCenter, personalAgent], enabled)
  if (registry.failures.length) console.error('Studio extension initialization failed:', registry.failures.join(', '))
  return registry
}
