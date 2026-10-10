import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('personalGateway', Object.freeze({
  chooseWorkspace: (label: string, capabilities: string[]) => ipcRenderer.invoke('personal:choose-workspace', { label, capabilities }),
}))
