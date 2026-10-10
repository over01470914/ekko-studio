export const CHAT_INITIALIZATION_WARNING_MS = 10_000

// A slow wait is a warning, not cancellation of a valid store request.
export function withChatInitializationWarning<T>(task: () => T | PromiseLike<T>, signal: AbortSignal, onSlow: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      callback()
    }
    const abort = () => finish(() => reject(new DOMException('Superseded initialization', 'AbortError')))
    const timer = setTimeout(() => { if (!settled && !signal.aborted) onSlow() }, CHAT_INITIALIZATION_WARNING_MS)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    Promise.resolve().then(task).then(value => finish(() => resolve(value)), error => finish(() => reject(error)))
  })
}

export function loadChatEnhancement(task: () => unknown, label: string): void {
  void Promise.resolve().then(task).catch(error => console.warn(label, error))
}
