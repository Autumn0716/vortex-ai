export type RuntimeMode = 'web' | 'electron';

export interface RuntimeCapabilityProfile {
  mode: RuntimeMode;
  label: string;
  hostBridge: {
    available: boolean;
    managed: boolean;
    status: 'unavailable' | FlowAgentDesktopInfo['host']['status'];
    url?: string;
    rootDir?: string;
    configPath?: string;
    message?: string;
  };
  filesystem: {
    projectFiles: boolean;
    configFiles: boolean;
    memoryFiles: boolean;
  };
  sandbox: {
    webContainer: boolean;
    hostShell: boolean;
    unrestrictedFilesystem: boolean;
  };
}

export const WEB_RUNTIME_CAPABILITIES: RuntimeCapabilityProfile = {
  mode: 'web',
  label: 'WEB · SANDBOX',
  hostBridge: {
    available: false,
    managed: false,
    status: 'unavailable',
    message: 'Browser mode has no built-in host bridge.',
  },
  filesystem: {
    projectFiles: false,
    configFiles: false,
    memoryFiles: false,
  },
  sandbox: {
    webContainer: true,
    hostShell: false,
    unrestrictedFilesystem: false,
  },
};

export function createRuntimeCapabilityProfile(
  desktopInfo?: FlowAgentDesktopInfo | null,
): RuntimeCapabilityProfile {
  if (!desktopInfo) {
    return WEB_RUNTIME_CAPABILITIES;
  }

  const hostReady = desktopInfo.host.status === 'ready' || desktopInfo.host.status === 'external';
  const hostCapabilities = desktopInfo.capabilities;

  return {
    mode: 'electron',
    label: `DESKTOP · HOST ${desktopInfo.host.status.toUpperCase()}`,
    hostBridge: {
      available: hostReady,
      managed: desktopInfo.host.managed,
      status: desktopInfo.host.status,
      url: desktopInfo.host.url,
      rootDir: desktopInfo.host.rootDir,
      configPath: desktopInfo.host.configPath,
      message: desktopInfo.host.message,
    },
    filesystem: {
      projectFiles: hostReady && (hostCapabilities?.projectFiles ?? true),
      configFiles: hostReady && (hostCapabilities?.configFiles ?? true),
      memoryFiles: hostReady && (hostCapabilities?.memoryFiles ?? true),
    },
    sandbox: {
      webContainer: hostCapabilities?.webContainerSandbox ?? true,
      hostShell: hostCapabilities?.hostShell ?? false,
      unrestrictedFilesystem: hostCapabilities?.unrestrictedFilesystem ?? false,
    },
  };
}
