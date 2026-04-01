import type { AgentConfig } from './agent/config';

export interface ThemePreset {
  id: string;
  name: string;
  color: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'ocean', name: 'Ocean', color: '#4f7cff' },
  { id: 'emerald', name: 'Emerald', color: '#16a34a' },
  { id: 'violet', name: 'Violet', color: '#8b5cf6' },
  { id: 'rose', name: 'Rose', color: '#f43f5e' },
  { id: 'amber', name: 'Amber', color: '#f59e0b' },
  { id: 'teal', name: 'Teal', color: '#14b8a6' },
  { id: 'sky', name: 'Sky', color: '#0ea5e9' },
  { id: 'indigo', name: 'Indigo', color: '#6366f1' },
  { id: 'slate', name: 'Slate', color: '#64748b' },
  { id: 'coral', name: 'Coral', color: '#fb7185' },
];

export const THEME_COLOR_BOARD = [
  '#2563eb',
  '#3b82f6',
  '#0ea5e9',
  '#06b6d4',
  '#14b8a6',
  '#10b981',
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#f43f5e',
  '#ec4899',
  '#d946ef',
  '#a855f7',
  '#8b5cf6',
  '#6366f1',
  '#64748b',
  '#0f172a',
];

const DARK_TOKENS = {
  '--app-bg': '#030308',
  '--app-bg-secondary': '#05050A',
  '--app-bg-sidebar': '#0A0A0F',
  '--app-bg-modal': '#1E1E1E',
  '--app-bg-modal-side': '#181818',
  '--app-surface': 'rgba(255,255,255,0.05)',
  '--app-surface-strong': 'rgba(255,255,255,0.1)',
  '--app-surface-soft': 'rgba(255,255,255,0.03)',
  '--app-input': 'rgba(0,0,0,0.22)',
  '--app-border': 'rgba(255,255,255,0.1)',
  '--app-border-soft': 'rgba(255,255,255,0.05)',
  '--app-text': 'rgba(255,255,255,0.96)',
  '--app-text-muted': 'rgba(255,255,255,0.78)',
  '--app-text-subtle': 'rgba(255,255,255,0.45)',
  '--app-shadow': '0 20px 60px rgba(0,0,0,0.35)',
};

const LIGHT_TOKENS = {
  '--app-bg': '#eef3fb',
  '--app-bg-secondary': '#f7f9fd',
  '--app-bg-sidebar': '#f4f7fb',
  '--app-bg-modal': '#f6f8fc',
  '--app-bg-modal-side': '#edf2f8',
  '--app-surface': 'rgba(255,255,255,0.78)',
  '--app-surface-strong': 'rgba(226,232,240,0.9)',
  '--app-surface-soft': 'rgba(255,255,255,0.62)',
  '--app-input': 'rgba(255,255,255,0.92)',
  '--app-border': 'rgba(15,23,42,0.1)',
  '--app-border-soft': 'rgba(15,23,42,0.06)',
  '--app-text': 'rgba(15,23,42,0.96)',
  '--app-text-muted': 'rgba(15,23,42,0.78)',
  '--app-text-subtle': 'rgba(15,23,42,0.52)',
  '--app-shadow': '0 20px 60px rgba(15,23,42,0.12)',
};

export function getThemePresetByColor(color: string) {
  return THEME_PRESETS.find((preset) => preset.color.toLowerCase() === color.trim().toLowerCase());
}

export function applyThemePreferences(config: Pick<AgentConfig, 'theme'> | null | undefined) {
  if (typeof document === 'undefined') {
    return;
  }

  const mode = config?.theme.mode ?? 'dark';
  const accentColor = config?.theme.accentColor ?? THEME_PRESETS[0]!.color;
  const root = document.documentElement;
  const tokens = mode === 'light' ? LIGHT_TOKENS : DARK_TOKENS;

  root.dataset.theme = mode;
  root.style.setProperty('--app-accent', accentColor);
  root.style.setProperty(
    '--app-accent-strong',
    `color-mix(in srgb, ${accentColor} 70%, #8b5cf6 30%)`,
  );
  root.style.setProperty(
    '--app-accent-soft',
    `color-mix(in srgb, ${accentColor} 16%, transparent)`,
  );

  Object.entries(tokens).forEach(([token, value]) => {
    root.style.setProperty(token, value);
  });
}
