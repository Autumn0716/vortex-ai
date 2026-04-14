import os from 'node:os';

export const DESKTOP_RUNTIME_CAPABILITIES = {
  hostBridge: true,
  projectFiles: true,
  configFiles: true,
  memoryFiles: true,
  webContainerSandbox: true,
  hostShell: false,
  unrestrictedFilesystem: false,
};

export function createDesktopInfoPayload({ hostState, platform, versions, capabilities = DESKTOP_RUNTIME_CAPABILITIES }) {
  return {
    mode: 'electron',
    platform,
    versions: {
      electron: versions.electron,
      chrome: versions.chrome,
      node: versions.node,
    },
    capabilities: { ...capabilities },
    host: { ...hostState },
  };
}

export async function createRuntimeDiagnosticsPayload({
  appVersion,
  hostState,
  probeHostHealth,
  platform,
  versions,
  pid,
  uptime,
  memoryUsage,
  osModule = os,
}) {
  const hostProbe = await probeHostHealth();

  return {
    appVersion,
    platform,
    versions: {
      electron: versions.electron,
      chrome: versions.chrome,
      node: versions.node,
    },
    mainProcess: {
      pid,
      uptimeSec: Math.round(uptime),
      rssBytes: memoryUsage.rss,
      heapUsedBytes: memoryUsage.heapUsed,
      heapTotalBytes: memoryUsage.heapTotal,
    },
    system: {
      totalMemoryBytes: osModule.totalmem(),
      freeMemoryBytes: osModule.freemem(),
      loadAverage: osModule.loadavg(),
    },
    host: {
      ...hostState,
      reachable: hostProbe.reachable,
      latencyMs: hostProbe.latencyMs,
      statusCode: hostProbe.statusCode,
      error: hostProbe.error ?? '',
    },
  };
}

export function registerFlowAgentDesktopHandlers({
  ipcMain,
  app,
  getHostState,
  probeHostHealth,
  processInfo = process,
  osModule = os,
  capabilities = DESKTOP_RUNTIME_CAPABILITIES,
}) {
  ipcMain.handle('flowagent:get-desktop-info', () =>
    createDesktopInfoPayload({
      hostState: getHostState(),
      platform: processInfo.platform,
      versions: processInfo.versions,
      capabilities,
    }),
  );

  ipcMain.handle('flowagent:get-runtime-diagnostics', () =>
    createRuntimeDiagnosticsPayload({
      appVersion: app.getVersion(),
      hostState: getHostState(),
      probeHostHealth,
      platform: processInfo.platform,
      versions: processInfo.versions,
      pid: processInfo.pid,
      uptime: processInfo.uptime(),
      memoryUsage: processInfo.memoryUsage(),
      osModule,
    }),
  );
}
