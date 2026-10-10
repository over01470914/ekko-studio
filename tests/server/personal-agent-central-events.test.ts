import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { CentralConnection } from '../../packages/server/src/modules/studio/extensions/personal-agent/central'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
describe('faithful central namespace protocol fixture (not live Naya)', () => {
  it('observes resume/delta/completion and never replays run or aborts on observer detach/reconnect/close', async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(req.url === '/api/auth/me' ? { user: { id: 4, status: 'active' } } : req.url === '/api/hermes/profiles' ? { profiles: [{ name: 'naya' }] } : { session: { id: 'fixture', profile: 'naya', user_id: '4', messages: [] } }))
    })
    const io = new Server(server); const seen: string[] = []
    io.of('/chat-run').use((socket, next) => { expect(socket.handshake.auth.token).toBe('central-fixture-token'); expect(socket.handshake.query.profile).toBe('naya'); next() })
    let centralSocket: any
    io.of('/chat-run').on('connection', socket => {
      centralSocket = socket
      socket.on('resume', data => { expect(data).toEqual({ session_id: 'fixture' }); seen.push('resume') })
      socket.on('abort', () => seen.push('abort'))
      socket.on('run', data => { expect(data).toEqual({ session_id: 'fixture', input: 'protocol test input' }); seen.push('run'); socket.emit('message.delta', { session_id: 'foreign', delta: 'must not leak' }); socket.emit('message.delta', { session_id: 'fixture', delta: 'explicit protocol fixture output', hidden: 'must not leak' }); socket.emit('run.completed', { session_id: 'fixture', run_id: 'fixture-run' }) })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(async () => { await new Promise<void>(resolve => io.close(() => resolve())) })
    const connection = new CentralConnection({ origin: `http://127.0.0.1:${(server.address() as any).port}`, token: 'central-fixture-token', principalId: 4, profile: 'naya', sessionId: 'fixture' })
    cleanups.push(async () => connection.close())
    const records: any[] = []; const stop = await connection.subscribe(event => records.push(event))
    await new Promise<void>((resolve, reject) => { const deadline = Date.now() + 3000; const tick = () => { if (seen.includes('resume')) return resolve(); if (Date.now() > deadline) return reject(new Error('fixture did not connect')); setTimeout(tick, 10) }; tick() })
    expect(await connection.send('protocol test input')).toMatchObject({ accepted: true, sessionId: 'fixture' })
    await new Promise<void>((resolve, reject) => { const deadline = Date.now() + 3000; const tick = () => { if (records.some(event => event.event === 'run.completed')) return resolve(); if (Date.now() > deadline) return reject(new Error('fixture output missing')); setTimeout(tick, 10) }; tick() })
    expect(records.find(event => event.event === 'message.delta').data).toEqual({ delta: 'explicit protocol fixture output' })
    stop(); centralSocket.conn.close()
    await new Promise<void>((resolve, reject) => { const deadline = Date.now() + 5000; const tick = () => { if (seen.filter(event => event === 'resume').length >= 2) return resolve(); if (Date.now() > deadline) return reject(new Error('fixture did not reconnect')); setTimeout(tick, 20) }; tick() })
    expect(seen.filter(event => event === 'run')).toHaveLength(1); expect(seen).not.toContain('abort')
    const replay: any[] = []; const detach = await connection.subscribe(event => replay.push(event), records[0].sequence)
    expect(replay.map(event => event.event)).toEqual(['run.completed']); detach(); connection.close()
    expect(seen.filter(event => event === 'run')).toHaveLength(1); expect(seen).not.toContain('abort')
  })
})
