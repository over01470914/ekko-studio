import { createHash } from 'node:crypto'

export const protocolSchema = require('../protocol.schema.json') as Record<string, any>
export const limits = Object.freeze(protocolSchema['x-limits'] as {
  maxFileBytes: number; maxReadBytes: number; maxWriteBytes: number; maxDepth: number; maxEntries: number;
  maxScanBytes: number; maxScanMs: number; maxPageItems: number; maxRequestBytes: number; maxResponseBytes: number;
  maxOperations: number; confirmationTtlMs: number; cursorTtlMs: number;
})
export type Capability = 'search' | 'read' | 'write' | 'delete'
interface BaseRequest { version: 1; operationId: string; deviceId: string; workspaceId: string; grantRevision: number }
export type FileRequest = BaseRequest & (
  { action: 'search'; query: string; mode: 'filename' | 'content' | 'both'; limit: number; cursor?: string } |
  { action: 'read'; path: string; offset?: number; length?: number } |
  { action: 'write'; path: string; mode: 'create'; content: string } |
  { action: 'write'; path: string; mode: 'overwrite'; content: string; expectedSha256: string } |
  { action: 'delete'; path: string; expectedSha256: string; confirmationId: string } |
  { action: 'status' }
)
export interface Target { deviceId: string; hostname: string; workspaceId: string }
export interface SearchItem { path: string; size: number; sha256: string; match: 'filename' | 'content' | 'both' }
export type ResultData =
  { items: SearchItem[]; hasMore: boolean; nextCursor: string | null; truncated: boolean; scannedEntries: number; scannedBytes: number; workspaceRevision: number } |
  { path: string; text: string; size: number; sha256: string; offset: number; byteLength: number; truncated: boolean; encoding: 'utf8' } |
  { path: string; size: number; sha256: string; workspaceRevision: number } |
  { path: string; sha256: string; deleted: true; restorable: true; receiptId: string; workspaceRevision: number } |
  { state: 'completed' | 'unknown' | 'rejected' | 'not-found'; code?: string }
export interface FileResponse { version: 1; operationId: string; target: Target; outcome: 'completed' | 'unknown'; action: FileRequest['action'] | 'restore'; data: ResultData }

// Only stable reason codes cross a transport; never reflect an OS exception/path/body.
export class PersonalError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); this.name = 'PersonalError' }
}
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export function plainJson(value: unknown, depth = 0): boolean {
  if (depth > 16) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.length <= 1024 && value.every(item => plainJson(item, depth + 1))
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Object.keys(descriptors).length <= 64 && Object.entries(descriptors).every(([key, desc]) =>
    !['__proto__', 'prototype', 'constructor'].includes(key) && 'value' in desc && plainJson(desc.value, depth + 1))
}
// Implements exactly the JSON Schema vocabulary used by the canonical contract.
export function matchesSchema(value: unknown, schema: Record<string, any>, root = protocolSchema): boolean {
  if (schema.$ref) {
    const target = schema.$ref.startsWith('#/$defs/') ? root.$defs[schema.$ref.slice(8)] : undefined
    return !!target && matchesSchema(value, target, root)
  }
  if (schema.oneOf && schema.oneOf.filter((item: Record<string, any>) => matchesSchema(value, item, root)).length !== 1) return false
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false
  if (schema.enum && !schema.enum.includes(value)) return false
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some((type: string) => type === 'null' ? value === null : type === 'object' ?
    !!value && typeof value === 'object' && !Array.isArray(value) : type === 'array' ? Array.isArray(value) :
    type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value) : typeof value === type)) return false
  if (typeof value === 'string') {
    const length = [...value].length
    if ((schema.minLength !== undefined && length < schema.minLength) ||
        (schema.maxLength !== undefined && length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value))) return false
  }
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))) return false
  if (Array.isArray(value) && ((schema.maxItems !== undefined && value.length > schema.maxItems) ||
      (schema.items && value.some(item => !matchesSchema(item, schema.items, root))))) return false
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if (schema.required?.some((key: string) => !Object.hasOwn(object, key))) return false
    if (schema.additionalProperties === false && Object.keys(object).some(key => !Object.hasOwn(schema.properties || {}, key))) return false
    if (Object.entries(object).some(([key, item]) => schema.properties?.[key] && !matchesSchema(item, schema.properties[key], root))) return false
  }
  return true
}
export function parseRequest(value: unknown): FileRequest {
  if (!plainJson(value) || !matchesSchema(value, protocolSchema) || Buffer.byteLength(canonical(value)) > limits.maxRequestBytes) throw new PersonalError('INVALID_REQUEST')
  return value as FileRequest
}
export function validateResponse(value: unknown): FileResponse {
  if (!plainJson(value) || !matchesSchema(value, protocolSchema.$defs.Response) || Buffer.byteLength(canonical(value)) > limits.maxResponseBytes) throw new PersonalError('INVALID_RESPONSE', 502)
  return value as FileResponse
}
