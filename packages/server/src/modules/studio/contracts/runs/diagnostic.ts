export interface ReadOnlyDiagnosticInput {
  sessionId: string
  profile: string
  userId: number
  queueId: string
  input: string
  instructions: string
  authorize: () => Promise<void>
  onEvent: (event: string, payload: unknown) => void
}

export class RunAdmissionDeferredError extends Error {
  constructor() { super('diagnostic_budget_deferred') }
}
