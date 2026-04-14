import path from 'node:path';

export function resolveElectronProjectRoot(app, sourceRoot) {
  const override = process.env.FLOWAGENT_DESKTOP_DATA_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }

  if (!app.isPackaged) {
    return sourceRoot;
  }

  return path.join(app.getPath('userData'), 'workspace');
}

export function resolveElectronRendererEntry(app, sourceRoot) {
  if (process.env.FLOWAGENT_RENDERER_URL?.trim()) {
    return {
      type: 'url',
      value: process.env.FLOWAGENT_RENDERER_URL.trim(),
    };
  }

  return {
    type: 'file',
    value: path.join(sourceRoot, 'dist/index.html'),
  };
}
