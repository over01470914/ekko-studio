import Router from '@koa/router'
import * as ctrl from './controller'
import type { PersonalAgentHost } from './host'
import type { PersonalFileService } from './workspaces'
import * as central from './central-controller'

export function createPersonalAgentRoutes(host: PersonalAgentHost, service: PersonalFileService | null) {
  const personalAgentRoutes = new Router()
  personalAgentRoutes.get('/api/studio/personal-agent/state', ctx => ctrl.state(ctx, host, service))
  personalAgentRoutes.post('/api/studio/personal-agent/operations', ctx => ctrl.execute(ctx, host, service))
  personalAgentRoutes.put('/api/studio/personal-agent/grants/:id', ctx => ctrl.setGrant(ctx, host, service))
  personalAgentRoutes.post('/api/studio/personal-agent/delete-confirmations', ctx => ctrl.confirmDelete(ctx, host, service))
  personalAgentRoutes.post('/api/studio/personal-agent/restore', ctx => ctrl.restore(ctx, host, service))
  personalAgentRoutes.get('/api/studio/personal-agent/central/state', ctx => central.state(ctx, host))
  personalAgentRoutes.post('/api/studio/personal-agent/central/connection', ctx => central.connect(ctx, host))
  personalAgentRoutes.get('/api/studio/personal-agent/central/history', ctx => central.history(ctx, host))
  personalAgentRoutes.post('/api/studio/personal-agent/central/run', ctx => central.run(ctx, host))
  personalAgentRoutes.get('/api/studio/personal-agent/central/events', ctx => central.events(ctx, host))
  return personalAgentRoutes
}
