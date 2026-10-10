import type { Context } from 'koa'
import type { PersonalFileService } from './workspaces'
import type { PersonalCentralStore } from './central-store'

export interface PersonalAgentHost {
  // The composition root rechecks the real active Studio account on each request.
  actorFor(ctx: Context): string | null
  createService(): PersonalFileService | null
  central?: PersonalCentralStore
}
