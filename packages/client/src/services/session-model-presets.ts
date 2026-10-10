import { computed, ref, type Ref } from 'vue'
import type { Session } from '@/stores/hermes/chat'
import type { ModelPreset } from '@/types/model-presets'
import type { ProviderApiMode } from '@/api/studio/provider-api-mode'
import { inferCodingAgentApiMode, normalizeCodingAgentApiMode } from '@/api/coding-agents'
import { useAppStore } from '@/stores/hermes/app'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { useModelPresetsStore } from '@/stores/hermes/model-presets'
import { modelPresetIssue, modelSupportsFastMode } from '@/utils/model-presets'
import { isBuiltinEkkoSession } from '@/utils/hermes/session-agent'

interface SessionModelPresetPort {
  sessions: Ref<Session[]>
  activeSession: Ref<Session | null>
  activeSessionId: Ref<string | null>
  switchSessionModel(model: string, provider?: string, sessionId?: string, apiMode?: ProviderApiMode): Promise<boolean>
  setSessionReasoningEffort(sessionId: string, effort: string): Promise<boolean>
  clearCodingAgentRuntimeCredentials(session: Session): void
}

export function createSessionModelPresets(port: SessionModelPresetPort) {
  const { sessions, activeSession, activeSessionId, switchSessionModel, setSessionReasoningEffort, clearCodingAgentRuntimeCredentials } = port
  const modelPresetWrites = new Map<string, Promise<boolean>>()
  const modelPresetSwitching = ref<Set<string>>(new Set())
  const isApplyingModelPreset = computed(() => !!activeSessionId.value && modelPresetSwitching.value.has(activeSessionId.value))
  function composerModelGroups(session: Session) {
    const app = useAppStore()
    return app.profileModelGroups.find(entry => entry.profile === session.profile)?.groups || app.modelGroups
  }

  function sessionSupportsFastMode(session: Session): boolean {
    if (!isBuiltinEkkoSession(session)) return false
    if (session.codingAgentMode === 'global') return false
    const app = useAppStore()
    const groups = composerModelGroups(session)
    const provider = session.provider || app.selectedProvider
    const group = groups.find(entry => entry.provider === provider)
    const apiMode = normalizeCodingAgentApiMode(session.apiMode || group?.api_mode, inferCodingAgentApiMode(provider, session.baseUrl || group?.base_url))
    if (apiMode !== 'chat_completions' && apiMode !== 'codex_responses') return false
    return modelSupportsFastMode(groups, provider, session.model || app.selectedModel)
  }

  function setSessionFastMode(sessionId: string, enabled: boolean): boolean {
    const session = sessions.value.find(entry => entry.id === sessionId) || (activeSession.value?.id === sessionId ? activeSession.value : null)
    if (!session || (enabled && !sessionSupportsFastMode(session))) return false
    session.fastMode = enabled
    if (activeSession.value?.id === sessionId) activeSession.value.fastMode = enabled
    return true
  }

  async function applyModelPreset(sessionId: string, step: ModelPreset): Promise<boolean> {
    const session = sessions.value.find(entry => entry.id === sessionId) || (activeSession.value?.id === sessionId ? activeSession.value : null)
    if (!session || session.provider === 'moa' || session.codingAgentMode === 'global' || modelPresetIssue(step, composerModelGroups(session))) return false
    if (modelPresetWrites.has(sessionId)) return false
    const previous = { model: session.model, provider: session.provider, apiMode: session.apiMode, baseUrl: session.baseUrl, apiKey: session.apiKey, reasoning: session.reasoningEffort, fastMode: session.fastMode }
    modelPresetSwitching.value = new Set(modelPresetSwitching.value).add(sessionId)
    const write = (async () => {
      try {
        const changesModel = session.model !== step.modelId || session.provider !== step.providerId
        if (changesModel && !await switchSessionModel(step.modelId, step.providerId, sessionId)) return false
        if (await setSessionReasoningEffort(sessionId, step.reasoningLevel || '')) {
          session.modelPresetId = step.id
          if (activeSession.value?.id === sessionId) activeSession.value.modelPresetId = step.id
          return true
        }
        if (changesModel && previous.model) {
          const restored = await switchSessionModel(previous.model, previous.provider, sessionId, previous.apiMode)
          if (restored) {
            session.baseUrl = previous.baseUrl
            session.apiKey = previous.apiKey
            await setSessionReasoningEffort(sessionId, previous.reasoning || '')
            setSessionFastMode(sessionId, previous.fastMode === true)
          }
        }
        return false
      } catch (error) {
        console.error('Failed to select composer step:', error)
        return false
      } finally {
        const next = new Set(modelPresetSwitching.value)
        next.delete(sessionId)
        modelPresetSwitching.value = next
        modelPresetWrites.delete(sessionId)
      }
    })()
    modelPresetWrites.set(sessionId, write)
    return write
  }

  function applyDefaultPreset(session: Session, options: Pick<Session, 'model' | 'provider' | 'baseUrl' | 'apiKey' | 'reasoningEffort'>) {
    const appStore = useAppStore()
    const presetConfig = useModelPresetsStore().get(session.profile || useProfilesStore().activeProfileName || 'default')
    const step = presetConfig.presets.find(entry => entry.id === presetConfig.defaultPresetId)
    const groups = appStore.profileModelGroups.find(entry => entry.profile === session.profile)?.groups || appStore.modelGroups
    if (step && !modelPresetIssue(step, groups) &&
      (!options.model || options.model === step.modelId) && (!options.provider || options.provider === step.providerId)) {
      const previousProvider = session.provider
      session.model = step.modelId
      session.provider = step.providerId
      session.reasoningEffort = (options.reasoningEffort ?? step.reasoningLevel) || undefined
      session.modelPresetId = (session.reasoningEffort || '') === (step.reasoningLevel || '') ? step.id : undefined
      if (previousProvider !== step.providerId && (options.baseUrl || options.apiKey)) clearCodingAgentRuntimeCredentials(session)
    }
  }

  return {
    applyDefaultPreset, applyModelPreset, setSessionFastMode, sessionSupportsFastMode, isApplyingModelPreset,
    pendingWrite: (sessionId: string) => modelPresetWrites.get(sessionId),
  }
}
