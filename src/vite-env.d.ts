/// <reference types="vite/client" />
interface FlowAgentDesktopInfo {
  mode: 'electron';
  platform: NodeJS.Platform;
  versions: {
    electron?: string;
    chrome?: string;
    node?: string;
  };
  host: {
    managed: boolean;
    status: 'starting' | 'external' | 'ready' | 'failed' | 'stopped';
    url: string;
    rootDir: string;
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
