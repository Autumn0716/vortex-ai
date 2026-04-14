import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('flowAgentDesktop', {
  getDesktopInfo: () => ipcRenderer.invoke('flowagent:get-desktop-info'),
});
