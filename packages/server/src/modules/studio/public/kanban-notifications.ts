/** Studio-owned origin admission, composed by bootstrap; Hermes never imports Studio storage. */
export interface KanbanOriginPort {
  validate(userId: number, sessionId: string): string // validated profile, or throws
  bind(input: { userId: number; sessionId: string; profile: string; board: string; taskId: string }): Promise<void>
}
let port: KanbanOriginPort | null = null
export function isKanbanReportingEnabled(): boolean { return port !== null }
export function setKanbanOriginPort(value: KanbanOriginPort | null): void { port = value }
export function validateKanbanOrigin(userId: number, sessionId: string): string {
  if (!port) throw new Error('kanban_reporting_unavailable')
  return port.validate(userId, sessionId)
}
export async function bindKanbanOrigin(input: Parameters<KanbanOriginPort['bind']>[0]): Promise<void> {
  if (!port) throw new Error('kanban_reporting_unavailable')
  await port.bind(input)
}
