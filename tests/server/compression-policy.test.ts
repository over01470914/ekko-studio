import { describe, expect, it } from 'vitest'
import { normalizeCompressionPolicy } from '../../packages/server/src/modules/studio/public/compression-policy'

describe('optional Studio compression token cap', () => {
  const existing = {
    enabled: false, threshold: 0.7, target_ratio: 0.3, protect_first_n: 2, protect_last_n: 8,
  }

  it('adds only an explicit positive finite integer and preserves existing fields', () => {
    expect(normalizeCompressionPolicy({ ...existing, threshold_tokens: 160_000 })).toEqual({
      enabled: false, threshold: 0.7, targetRatio: 0.3, protectFirstN: 2, protectLastN: 8,
      thresholdTokens: 160_000,
    })
    expect(normalizeCompressionPolicy({ threshold_tokens: 1 }).thresholdTokens).toBe(1)
  })

  it.each([undefined, null, false, true, 0, -1, 1.5, '160000', '', NaN, Infinity, -Infinity, {}, []])(
    'ignores invalid or absent cap %j without changing the old policy shape', (threshold_tokens) => {
      const policy = normalizeCompressionPolicy({ ...existing, threshold_tokens })
      expect(policy).toEqual(normalizeCompressionPolicy(existing))
      expect(policy).not.toHaveProperty('thresholdTokens')
    },
  )
})
