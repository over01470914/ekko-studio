import { PersonalReceiver, type ReceiverConfig } from './receiver'
import { createReceiverServer } from './http'
import { readPrivateConfig } from './private-config'
import { PersonalError } from './protocol'

// Controlled pilot. Receiver roots and owner approvals come only from an operator-owned private file.
// No owner-control endpoint is exposed over HTTP; IPC, if present, is the launching local owner's channel.
if (require.main === module) {
  let receiver: PersonalReceiver | undefined
  try {
    const config = readPrivateConfig(process.argv[2])
    if (config.version !== 1 || !Number.isInteger(config.port) || Number(config.port) < 0 || Number(config.port) > 65535) throw new PersonalError('INVALID_CONFIGURATION')
    receiver = new PersonalReceiver(config.receiver as ReceiverConfig)
    const server = createReceiverServer(receiver)
    const active = receiver
    server.listen(Number(config.port), '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      const ready = { event: 'ready', version: 1, deviceId: active.deviceId, origin }
      if (process.send) process.send(ready)
      else process.stdout.write(`${JSON.stringify(ready)}\n`)
    })
    server.on('error', () => { process.stderr.write('PERSONAL_RECEIVER_LISTEN_FAILED\n'); active.close(); process.exitCode = 1 })
    if (process.send && config.ownerControl === true && typeof config.ownerId === 'string') {
      process.on('message', (message: any) => {
        try {
          if (!message || typeof message !== 'object') return
          let result: unknown
          if (message.action === 'state') result = active.stateFor(config.ownerId as string)
          else if (message.action === 'set-grant') result = active.setGrant(config.ownerId as string, message.grantId, message.expectedRevision, message.capabilities)
          else if (message.action === 'confirm-delete') result = active.confirmDelete(config.ownerId as string, message.sourceDeviceId, message.request)
          else if (message.action === 'restore') result = active.restore(config.ownerId as string, message.receiptId)
          else if (message.action === 'reserve-operation') {
            active.reserveOperation(active.authenticate(message.credential, message.sourceOrigin), message.request)
            result = { reserved: true }
          } else throw new PersonalError('INVALID_REQUEST')
          process.send?.({ event: 'reply', id: message.id, result })
        } catch (error) { process.send?.({ event: 'reply', id: message?.id, error: error instanceof PersonalError ? error.code : 'CONTROL_FAILED' }) }
      })
    }
    const stop = () => { server.close(() => { active.close(); process.disconnect?.(); process.exit(0) }); server.closeIdleConnections() }
    process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('disconnect', stop)
  } catch { receiver?.close(); process.stderr.write('PERSONAL_RECEIVER_START_FAILED\n'); process.exitCode = 1 }
}
