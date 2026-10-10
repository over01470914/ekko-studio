import { readConfigYamlForProfile } from '../public/profile-config'
import { logger } from '../public/logging'

export interface CompressionPolicy {
  enabled: boolean
  threshold: number
  thresholdTokens?: number
  targetRatio: number
  protectFirstN: number
  protectLastN: number
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
}

export function normalizeCompressionPolicy(value: unknown): CompressionPolicy {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  return {
    enabled: raw.enabled !== false,
    threshold: clamp(raw.threshold, 0.5, 0.05, 0.95),
    ...(typeof raw.threshold_tokens === 'number' && Number.isFinite(raw.threshold_tokens)
      && Number.isInteger(raw.threshold_tokens) && raw.threshold_tokens > 0
      ? { thresholdTokens: raw.threshold_tokens } : {}),
    targetRatio: clamp(raw.target_ratio, 0.2, 0.01, 0.8),
    protectFirstN: Math.floor(clamp(raw.protect_first_n, 3, 0, 100)),
    protectLastN: Math.floor(clamp(raw.protect_last_n, 20, 0, 500)),
  }
}

export async function readCompressionPolicy(profile: string): Promise<CompressionPolicy> {
  try {
    return normalizeCompressionPolicy((await readConfigYamlForProfile(profile))?.compression)
  } catch (err) {
    logger.warn(err, '[context-compress] failed to read compression config for profile %s, using defaults', profile)
    return normalizeCompressionPolicy(undefined)
  }
}
