import { createPersonalAgentController, type PersonalClientHost } from './controller'
let installed: { host: PersonalClientHost; controller: ReturnType<typeof createPersonalAgentController> } | null = null
export function installPersonalAgentHost(host: PersonalClientHost) {
  if (installed) throw new Error('Personal module already installed')
  const controller = createPersonalAgentController(host); installed = { host, controller }
  return () => { controller.dispose(); installed = null }
}
export function personalAgentHost() { if (!installed) throw new Error('Personal module unavailable'); return installed }
