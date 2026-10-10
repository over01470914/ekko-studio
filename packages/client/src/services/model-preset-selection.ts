import type { Session } from '@/stores/hermes/chat'
import type { ModelPreset } from '@/types/model-presets'
import { sameModelPresetCombination } from '@/utils/model-presets'

export interface PresetSelectionSnapshot {
  sessionId: string | null
  profile: string
  provider: string
  model: string
  reasoning: string
  fast: boolean
}
interface SelectionPort {
  activeSessionId: string | null
  activeSession: Session | null
  newChat(options: { profile: string; model: string; provider: string }): Session
  applyModelPreset(sessionId: string, preset: ModelPreset): Promise<boolean>
  setSessionFastMode(sessionId: string, enabled: boolean): boolean
}
export type PresetCommitResult = 'ok' | 'selection-failed' | 'fast-failed' | 'stale'
/** One close-time transaction adapter. The preview UI never sees session APIs. */
export async function commitModelPresetSelection(port: SelectionPort, before: PresetSelectionSnapshot,
  preset: ModelPreset, fast: boolean, selectedPresetId?: string): Promise<PresetCommitResult> {
  if (port.activeSessionId !== before.sessionId) return 'stale'
  let changesSelection = !sameModelPresetCombination(preset, { providerId: before.provider, modelId: before.model, reasoningLevel: before.reasoning })
  const changesIdentity = !!selectedPresetId && port.activeSession?.modelPresetId !== selectedPresetId
  if (!changesSelection && !changesIdentity && before.fast === fast) return 'ok'
  let sid = before.sessionId
  if (!sid) {
    const created = port.newChat({ profile: before.profile, model: preset.modelId, provider: preset.providerId })
    sid = created.id
    // newChat may apply the Profile's default preset. An explicit panel choice
    // must win even when it matched the pre-session model/effort display.
    changesSelection = !sameModelPresetCombination(preset, { providerId: created.provider || '', modelId: created.model || '', reasoningLevel: created.reasoningEffort })
  }
  if (changesSelection && !await port.applyModelPreset(sid, preset)) return 'selection-failed'
  // Changing a model clears Fast in the port, so the final draft must be applied
  // after that write. Reasoning-only changes leave the independent Fast flag intact.
  if ((changesSelection || before.fast !== fast) && !port.setSessionFastMode(sid, fast)) return 'fast-failed'
  if (selectedPresetId && port.activeSession?.id === sid) port.activeSession.modelPresetId = selectedPresetId
  return 'ok'
}
