import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('flowAgentDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
