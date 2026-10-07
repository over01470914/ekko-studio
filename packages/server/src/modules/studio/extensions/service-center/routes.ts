import Router from '@koa/router'
import * as ctrl from './controller'

export const serviceCenterRoutes = new Router()
serviceCenterRoutes.get('/api/studio/service-center/catalog', ctrl.listCatalog)
serviceCenterRoutes.get('/api/studio/service-center/manifest', ctrl.exportManifest)
serviceCenterRoutes.put('/api/studio/service-center/services', ctrl.save)
serviceCenterRoutes.delete('/api/studio/service-center/services/:id', ctrl.remove)
serviceCenterRoutes.post('/api/studio/service-center/import/preview', ctrl.preview)
serviceCenterRoutes.post('/api/studio/service-center/import/confirm', ctrl.confirm)
serviceCenterRoutes.put('/api/studio/service-center/favorites/:id', ctrl.favorite)
serviceCenterRoutes.post('/api/studio/service-center/health/:id', ctrl.checkHealth)
serviceCenterRoutes.put('/api/studio/service-center/health/:id/approval', ctrl.approve)
serviceCenterRoutes.get('/api/studio/service-center/editors', ctrl.editors)
serviceCenterRoutes.put('/api/studio/service-center/editors/:id', ctrl.changeEditor)
