import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('flowAgentDesktop', {
  getDesktopInfo: () => ipcRenderer.invoke('vortex:get-desktop-info'),
  getRuntimeDiagnostics: () => ipcRenderer.invoke('vortex:get-runtime-diagnostics'),
  showNotification: (payload) => ipcRenderer.invoke('vortex:show-notification', payload),
  showOpenDialog: (options) => ipcRenderer.invoke('vortex:show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('vortex:show-save-dialog', options),
});
