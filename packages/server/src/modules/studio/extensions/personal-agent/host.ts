import type { Context } from 'koa'
import type { PersonalAgentService } from './service'

export interface PersonalAgentHost {
  // The composition root rechecks the real active Studio account on each request.
  actorFor(ctx: Context): string | null
  createService(): PersonalAgentService | null
}
