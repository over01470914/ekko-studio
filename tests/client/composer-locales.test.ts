import { describe, expect, it } from 'vitest'
import locale0 from '../../packages/client/src/i18n/locales/ar'
import locale1 from '../../packages/client/src/i18n/locales/de'
import locale2 from '../../packages/client/src/i18n/locales/en'
import locale3 from '../../packages/client/src/i18n/locales/es'
import locale4 from '../../packages/client/src/i18n/locales/fr'
import locale5 from '../../packages/client/src/i18n/locales/ja'
import locale6 from '../../packages/client/src/i18n/locales/ko'
import locale7 from '../../packages/client/src/i18n/locales/pt'
import locale8 from '../../packages/client/src/i18n/locales/ru'
import locale9 from '../../packages/client/src/i18n/locales/zh'
import locale10 from '../../packages/client/src/i18n/locales/zh-TW'

const locales = { "ar": locale0, "de": locale1, "en": locale2, "es": locale3, "fr": locale4, "ja": locale5, "ko": locale6, "pt": locale7, "ru": locale8, "zh": locale9, "zh-TW": locale10 }
const keys = ['description', 'add', 'name', 'provider', 'model', 'reasoning', 'default', 'moveUp', 'moveDown', 'remove', 'save', 'saved', 'saveFailed', 'invalidModel', 'invalidReasoning', 'empty', 'preview', 'previewHint', 'manage', 'custom', 'switchFailed', 'fastMode', 'fastModeHint', 'fastUnavailable', 'nextMessage', 'reset', 'fastModeCostHint', 'modelPresetsTitle', 'loadingPresets', 'loadFailed', 'newChatDefault', 'presetChanged', 'orderHint', 'noDefault', 'noPresets', 'reorder', 'clearNewChatDefault']

describe('Composer locale contract', () => {
  it('has every shared Composer key in every locale', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      expect(Object.keys(messages.composer).sort(), locale).toEqual([...keys].sort())
      for (const key of keys) {
        const value = (messages.composer as Record<string, string>)[key]
        expect(value, locale + '.' + key).toEqual(expect.any(String))
        expect(value.trim().length, locale + '.' + key).toBeGreaterThan(0)
      }
    }
  })
  it('fully translates both Chinese locales rather than using the English fallback', () => {
    for (const key of keys.filter(key => key !== 'saved')) {
      expect((locale9.composer as Record<string, string>)[key]).not.toBe((locale2.composer as Record<string, string>)[key])
      expect((locale10.composer as Record<string, string>)[key]).not.toBe((locale2.composer as Record<string, string>)[key])
    }
  })
})
