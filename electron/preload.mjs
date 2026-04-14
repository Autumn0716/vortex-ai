import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('flowAgentDesktop', {
  getDesktopInfo: () => ipcRenderer.invoke('flowagent:get-desktop-info'),
  getRuntimeDiagnostics: () => ipcRenderer.invoke('flowagent:get-runtime-diagnostics'),
});
