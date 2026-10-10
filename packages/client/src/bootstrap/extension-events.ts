// Host adapter: only same-origin module events; credentials never go to a central origin here.
export function observeModuleEvents(path: string, listener: (event: any) => void, after = 0, authorization?: () => string) {
  if (!/^\/api\/studio\/personal-agent\/central\/events$/.test(path)) throw new Error('INVALID_EVENT_PATH')
  const abort = new AbortController(); let sequence = after
  async function run() {
    let attempts = 0
    while (!abort.signal.aborted && attempts++ < 10) {
      try {
        const token = authorization?.()
        const response = await fetch(`${path}?after=${sequence}`, { redirect: 'error', signal: abort.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('EVENTS_UNAVAILABLE')
        const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = ''
        try { while (!abort.signal.aborted) {
          const item = await reader.read(); if (item.done) break
          buffer += decoder.decode(item.value, { stream: true })
          if (buffer.length > 131072) throw new Error('EVENTS_LIMIT')
          let end: number
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
            const data = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n')
            if (!data) continue
            const event = JSON.parse(data)
            if (!Number.isSafeInteger(event.sequence) || event.sequence <= sequence) continue
            sequence = event.sequence; listener(event)
          }
        } } finally { await reader.cancel() }
      } catch { if (!abort.signal.aborted) listener({ event: 'connection.failed', sequence: sequence + 1, data: { code: 'CENTRAL_UNAVAILABLE' } }) }
      if (!abort.signal.aborted) await new Promise<void>(resolve => { const timer = setTimeout(resolve, Math.min(4000, attempts * 500)); abort.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) })
    }
  }
  void run(); return () => abort.abort()
}
