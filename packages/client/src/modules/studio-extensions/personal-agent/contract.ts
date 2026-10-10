// Renderer-only types mirror the accepted protocol v1; contract tests assert exact equality.
// Do not import the Node receiver/runtime into the client graph.
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
