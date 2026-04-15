import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('flowAgentDesktop', {
  getDesktopInfo: () => ipcRenderer.invoke('flowagent:get-desktop-info'),
  getRuntimeDiagnostics: () => ipcRenderer.invoke('flowagent:get-runtime-diagnostics'),
  showNotification: (payload) => ipcRenderer.invoke('flowagent:show-notification', payload),
  showOpenDialog: (options) => ipcRenderer.invoke('flowagent:show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('flowagent:show-save-dialog', options),
});
