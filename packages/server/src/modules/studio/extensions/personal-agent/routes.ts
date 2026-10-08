import Router from '@koa/router'
import * as ctrl from './controller'
import type { PersonalAgentHost } from './host'
import type { PersonalAgentService } from './service'

export function createPersonalAgentRoutes(host: PersonalAgentHost, service: PersonalAgentService | null) {
  const personalAgentRoutes = new Router()
  personalAgentRoutes.get('/api/studio/personal-agent/state', ctx => ctrl.state(ctx, host, service))
  personalAgentRoutes.post('/api/studio/personal-agent/operations', ctx => ctrl.execute(ctx, host, service))
  personalAgentRoutes.put('/api/studio/personal-agent/grants/:id', ctx => ctrl.setGrant(ctx, host, service))
  personalAgentRoutes.post('/api/studio/personal-agent/delete-confirmations', ctx => ctrl.confirmDelete(ctx, host, service))
  personalAgentRoutes.post('/api/studio/personal-agent/restore', ctx => ctrl.restore(ctx, host, service))
  return personalAgentRoutes
}
