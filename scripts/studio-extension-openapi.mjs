import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Only a real, non-symlinked file directly beneath a Studio extension directory
// is executed at build time; directory names alone never grant execution.
export async function loadStudioExtensionOpenApi(sourceDir) {
  const root = join(sourceDir, 'modules/studio/extensions')
  if (!existsSync(root)) return []
  const contracts = []
  for (const entry of readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
    const file = join(root, entry.name, 'openapi.mjs')
    if (!existsSync(file)) continue
    if (!lstatSync(file).isFile()) throw new Error(`Invalid Studio extension OpenAPI source: ${entry.name}`)
    const { studioExtensionOpenApi: contract } = await import(pathToFileURL(file).href)
    if (!contract || contract.id !== entry.name || !/^[a-z]+(?:-[a-z]+)*$/.test(entry.name) ||
        typeof contract.tag?.name !== 'string' || typeof contract.extend !== 'function') {
      throw new Error(`Invalid Studio extension OpenAPI contract: ${entry.name}`)
    }
    contracts.push(contract)
  }
  return contracts
}

export function applyStudioExtensionOpenApi(openapi, contract) {
  const prefix = `/api/studio/${contract.id}/`
  const existingPaths = new Map(Object.entries(openapi.paths).map(([path, operations]) => [path, JSON.stringify(operations)]))
  const existingSchemas = new Map(Object.entries(openapi.components.schemas).map(([name, schema]) => [name, JSON.stringify(schema)]))
  const existingIds = new Set(Object.values(openapi.paths).flatMap(path =>
    Object.values(path).map(operation => operation.operationId).filter(Boolean)))
  contract.extend(openapi)
  for (const [path, snapshot] of existingPaths) {
    if (!path.startsWith(prefix) && JSON.stringify(openapi.paths[path]) !== snapshot) {
      throw new Error(`Studio extension modified host API: ${path}`)
    }
  }
  for (const [schema, snapshot] of existingSchemas) {
    if (JSON.stringify(openapi.components.schemas[schema]) !== snapshot) throw new Error(`Studio extension changed host schema: ${schema}`)
  }
  const moduleSchemas = Object.keys(openapi.components.schemas).filter(name => !existingSchemas.has(name))
  if (!moduleSchemas.length) throw new Error(`Studio extension has no schemas: ${contract.id}`)
  const operations = Object.entries(openapi.paths).filter(([path]) => path.startsWith(prefix))
  if (!operations.length) throw new Error(`Studio extension has no scanned routes: ${contract.id}`)
  const ownedIds = new Set()
  for (const [path, methods] of operations) {
    if (!existingPaths.has(path)) throw new Error(`Studio extension route not scanned: ${path}`)
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) ||
          !operation.operationId || ownedIds.has(operation.operationId) ||
          (existingIds.has(operation.operationId) && !Object.values(JSON.parse(existingPaths.get(path))).some(before => before.operationId === operation.operationId)) ||
          !operation.tags?.includes(contract.tag.name) || !operation.responses || !Object.keys(operation.responses).length ||
          JSON.stringify(operation.security) !== JSON.stringify([{ BearerAuth: [] }])) {
        throw new Error(`Invalid Studio extension operation: ${method} ${path}`)
      }
      ownedIds.add(operation.operationId)
    }
  }
  const refs = JSON.stringify({ operations, schemas: moduleSchemas.map(name => openapi.components.schemas[name]) })
  for (const match of refs.matchAll(/#\/components\/schemas\/([A-Za-z0-9_-]+)/g)) {
    if (!(match[1] in openapi.components.schemas)) throw new Error(`Missing Studio extension schema: ${match[1]}`)
  }
}
