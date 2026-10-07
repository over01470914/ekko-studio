import { inject, type InjectionKey } from 'vue'
export type ServiceCenterTranslate = (key: string, named?: Record<string, string | number>) => string
export const serviceCenterTranslationKey: InjectionKey<ServiceCenterTranslate> = Symbol('service-center-translate')
export function useServiceCenterTranslation(): ServiceCenterTranslate {
  const translate = inject(serviceCenterTranslationKey)
  if (!translate) throw new Error('Service Center translation provider missing')
  return translate
}
