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

export function registerVortexDesktopHandlers({
  ipcMain,
  app,
  getHostState,
  probeHostHealth,
  notificationApi,
  dialogApi,
  processInfo = process,
  osModule = os,
  capabilities = DESKTOP_RUNTIME_CAPABILITIES,
}) {
  ipcMain.handle('vortex:get-desktop-info', () =>
    createDesktopInfoPayload({
      hostState: getHostState(),
      platform: processInfo.platform,
      versions: processInfo.versions,
      capabilities,
    }),
  );

  ipcMain.handle('vortex:get-runtime-diagnostics', () =>
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

  ipcMain.handle('vortex:show-notification', (_event, payload = {}) => {
    if (!notificationApi?.isSupported?.()) {
      return { shown: false, reason: 'unsupported' };
    }

    const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Vortex';
    const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 240) : '';
    const notification = new notificationApi.Notification({
      title,
      body,
    });
    notification.show();
    return { shown: true };
  });

  ipcMain.handle('vortex:show-open-dialog', (_event, options = {}) => {
    if (!dialogApi?.showOpenDialog) {
      return { canceled: true, filePaths: [] };
    }
    return dialogApi.showOpenDialog({
      title: typeof options.title === 'string' ? options.title : 'Open',
      properties: Array.isArray(options.properties) ? options.properties : ['openFile'],
      filters: Array.isArray(options.filters) ? options.filters : undefined,
    });
  });

  ipcMain.handle('vortex:show-save-dialog', (_event, options = {}) => {
    if (!dialogApi?.showSaveDialog) {
      return { canceled: true };
    }
    return dialogApi.showSaveDialog({
      title: typeof options.title === 'string' ? options.title : 'Save',
      defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
      filters: Array.isArray(options.filters) ? options.filters : undefined,
    });
  });
}
