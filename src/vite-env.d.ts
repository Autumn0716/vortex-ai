/// <reference types="vite/client" />
interface FlowAgentDesktopInfo {
  mode: 'electron';
  platform: NodeJS.Platform;
  versions: {
    electron?: string;
    chrome?: string;
    node?: string;
  };
  capabilities?: {
    hostBridge: boolean;
    projectFiles: boolean;
    configFiles: boolean;
    memoryFiles: boolean;
    webContainerSandbox: boolean;
    hostShell: boolean;
    unrestrictedFilesystem: boolean;
  };
  host: {
    managed: boolean;
    status: 'starting' | 'external' | 'ready' | 'failed' | 'stopped';
    url: string;
    rootDir: string;
    sourceRoot?: string;
    message: string;
    startedAt?: string | null;
    readyAt?: string | null;
  };
}

interface Window {
  flowAgentDesktop?: {
    getDesktopInfo: () => Promise<FlowAgentDesktopInfo>;
  };
}
