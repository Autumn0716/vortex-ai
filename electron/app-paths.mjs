import path from 'node:path';
import fs from 'node:fs';

function hasProjectMarkers(rootDir) {
  if (!rootDir) {
    return false;
  }

  const markers = ['config.json', 'memory', '.git'];
  return markers.some((entry) => fs.existsSync(path.join(rootDir, entry)));
}

export function resolveElectronProjectRoot(app, sourceRoot) {
  const override = process.env.FLOWAGENT_DESKTOP_DATA_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }

  if (!app.isPackaged) {
    return sourceRoot;
  }

  const cwd = process.cwd();
  if (hasProjectMarkers(cwd)) {
    return path.resolve(cwd);
  }

  return path.join(app.getPath('userData'), 'workspace');
}

export function resolveElectronConfigImportSource(app, sourceRoot, options = {}) {
  if (!app.isPackaged) {
    return null;
  }

  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const explicit = env.FLOWAGENT_DESKTOP_IMPORT_CONFIG?.trim();
  const candidates = [
    explicit ? path.resolve(explicit) : null,
    path.join(cwd, 'config.json'),
    path.join(sourceRoot, 'config.json'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
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
