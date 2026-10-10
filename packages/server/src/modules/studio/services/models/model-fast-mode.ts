import { modelSupportsFastMode, type ModelFastModeQuery } from '../../public/model-fast-mode'
import { getModelCatalog } from './model-catalog'
import { resolveCatalogModel } from './model-metadata'

/** Catalog capability overrides are provider-specific: never borrow a tier from an ID-only match. */
export function resolveModelFastMode(query: ModelFastModeQuery): boolean {
  const catalog = getModelCatalog()
  const match = catalog ? resolveCatalogModel(catalog, query) : undefined
  const override = match && match.matchedBy !== 'model' ? match.model.fast_mode : undefined
  return modelSupportsFastMode({ ...query, fastModeOverride: query.fastModeOverride ?? override })
}
