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
    configPath?: string;
    configImportedFrom?: string;
    sourceRoot?: string;
    message: string;
    startedAt?: string | null;
    readyAt?: string | null;
    pid?: number | null;
    lastExitCode?: number | null;
  };
}

interface FlowAgentRuntimeDiagnostics {
  appVersion: string;
  platform: NodeJS.Platform;
  versions: {
    electron?: string;
    chrome?: string;
    node?: string;
  };
  mainProcess: {
    pid: number;
    uptimeSec: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  system: {
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    loadAverage: number[];
  };
  host: FlowAgentDesktopInfo['host'] & {
    reachable: boolean;
    latencyMs: number;
    statusCode: number | null;
    error?: string;
  };
}

interface Window {
  flowAgentDesktop?: {
    getDesktopInfo: () => Promise<FlowAgentDesktopInfo>;
    getRuntimeDiagnostics: () => Promise<FlowAgentRuntimeDiagnostics>;
    showNotification: (payload: { title?: string; body?: string }) => Promise<{ shown: boolean; reason?: string }>;
    showOpenDialog: (options?: {
      title?: string;
      properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'>;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
    showSaveDialog: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<{ canceled: boolean; filePath?: string }>;
  };
}
