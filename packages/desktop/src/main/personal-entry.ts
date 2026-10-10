import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getPersonalLabIdentity, trustedPersonalRenderer } from './personal-lab-identity'

// Optional package entry; deliberately never imports normal main/index, updater or runtime/Bridge ownership.
const identity = getPersonalLabIdentity(app.getPath('appData'))
app.setName(identity.name); app.setPath('userData', identity.userData)
mkdirSync(identity.userData, { recursive: true, mode: 0o700 })
if (process.env.PERSONAL_LAB_CDP_PORT && /^\d{4,5}$/.test(process.env.PERSONAL_LAB_CDP_PORT)) app.commandLine.appendSwitch('remote-debugging-port', process.env.PERSONAL_LAB_CDP_PORT)
let child: ChildProcess | null = null; let window: BrowserWindow | null = null
let origin = ''; let quitting = false
const token = randomBytes(32).toString('hex')
const replies = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { window?.show(); window?.focus() })
  app.on('before-quit', () => { quitting = true; child?.kill('SIGTERM') })
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(async () => {
    const resources = app.isPackaged ? process.resourcesPath : resolve(__dirname, '../../../../dist/personal-lab')
    child = fork(join(resources, 'personal-gateway.cjs'), [], {
      execPath: process.execPath, cwd: resources, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', HOME: app.getPath('home'), TMPDIR: app.getPath('temp'), LANG: 'en_US.UTF-8' },
    })
    child.on('message', (message: any) => {
      if (message?.event !== 'reply' || typeof message.id !== 'string') return
      const pending = replies.get(message.id); if (!pending) return
      clearTimeout(pending.timer); replies.delete(message.id)
      if (message.error) pending.reject(new Error('ONBOARDING_UNAVAILABLE')); else pending.resolve(message.workspace)
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('GATEWAY_START_TIMEOUT')), 15000)
      child!.on('message', (message: any) => {
        if (message?.event === 'ready' && message.origin === 'http://127.0.0.1:4362') { origin = message.origin; clearTimeout(timer); resolve() }
        if (message?.event === 'failed') { clearTimeout(timer); reject(new Error('GATEWAY_START_FAILED')) }
      })
      child!.once('exit', () => { clearTimeout(timer); reject(new Error('GATEWAY_START_FAILED')) })
      child!.send({ dataRoot: join(identity.home, 'gateway'), clientDir: join(resources, 'client'), ownerId: 'native-owner', token, port: identity.port })
    })
    writeFileSync(join(identity.home, 'native-runtime.json'), JSON.stringify({ mode: 'personal-gateway', pid: child.pid, cwd: resources, port: identity.port, localAgent: false, localBridge: false, updateChannel: identity.channel }), { mode: 0o600 })
    window = new BrowserWindow({ width: 1440, height: 1000, minWidth: 360, minHeight: 600, title: identity.name,
      webPreferences: { preload: join(__dirname, '../preload/personal.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:personal-lab' } })
    const nativeWindow = window
    nativeWindow.webContents.session.webRequest.onBeforeSendHeaders({ urls: [origin + '/api/*'] }, (details, callback) => {
      // The fixed loopback bearer belongs to native main. It is not exposed to JS, cache, central APIs or redirects.
      if (details.webContentsId === nativeWindow.webContents.id && trustedPersonalRenderer(nativeWindow.webContents.getURL())) details.requestHeaders.Authorization = `Bearer ${token}`
      callback({ requestHeaders: details.requestHeaders })
    })
    nativeWindow.webContents.on('will-navigate', (event, url) => { if (!trustedPersonalRenderer(url)) event.preventDefault() })
    nativeWindow.webContents.on('will-redirect', event => event.preventDefault())
    nativeWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    ipcMain.handle('personal:choose-workspace', async (event, input: { label?: unknown; capabilities?: unknown }) => {
      if (event.sender !== nativeWindow.webContents || event.senderFrame !== nativeWindow.webContents.mainFrame || !trustedPersonalRenderer(event.senderFrame.url) ||
        typeof input?.label !== 'string' || !input.label.trim() || input.label.length > 128 || !Array.isArray(input.capabilities) || input.capabilities.length > 4 ||
        input.capabilities.some(capability => !['search', 'read', 'write', 'delete'].includes(capability))) throw new Error('FORBIDDEN')
      const picked = await dialog.showOpenDialog(nativeWindow, { properties: ['openDirectory'], title: identity.name })
      if (picked.canceled || picked.filePaths.length !== 1) return null
      return new Promise((resolve, reject) => {
        const id = randomUUID(); const timer = setTimeout(() => { replies.delete(id); reject(new Error('ONBOARDING_UNAVAILABLE')) }, 15000)
        replies.set(id, { resolve, reject, timer })
        child!.send({ event: 'onboard', id, root: picked.filePaths[0], label: input.label, capabilities: input.capabilities })
      })
    })
    child.once('exit', () => { for (const pending of replies.values()) { clearTimeout(pending.timer); pending.reject(new Error('GATEWAY_UNAVAILABLE')) }; replies.clear(); if (!quitting) app.quit() })
    await nativeWindow.loadURL(origin + '/personal.html')
  }).catch(() => { dialog.showErrorBox(identity.name, 'PERSONAL_GATEWAY_UNAVAILABLE'); app.quit() })
}
