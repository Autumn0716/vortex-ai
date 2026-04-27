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
  '--app-bg': '#0f0f10',
  '--app-bg-secondary': '#121213',
  '--app-bg-sidebar': '#0d0d0e',
  '--app-bg-modal': '#151516',
  '--app-bg-modal-side': '#111112',
  '--app-card-bg': 'rgba(255,255,255,0.035)',
  '--app-surface': 'rgba(255,255,255,0.045)',
  '--app-surface-strong': 'rgba(255,255,255,0.09)',
  '--app-surface-soft': 'rgba(255,255,255,0.02)',
  '--app-input': 'rgba(0,0,0,0.22)',
  '--app-border': 'rgba(255,255,255,0.1)',
  '--app-border-soft': 'rgba(255,255,255,0.05)',
  '--app-text': 'rgba(255,255,255,0.96)',
  '--app-text-muted': 'rgba(255,255,255,0.78)',
  '--app-text-subtle': 'rgba(255,255,255,0.45)',
  '--app-shadow': '0 18px 45px rgba(0,0,0,0.30)',
};

const LIGHT_TOKENS = {
  '--app-bg': '#eceef2',
  '--app-bg-secondary': '#f3f4f6',
  '--app-bg-sidebar': '#e4e6eb',
  '--app-bg-modal': '#f3f4f6',
  '--app-bg-modal-side': '#e9ebef',
  '--app-card-bg': '#f7f7f8',
  '--app-surface': 'rgba(32,35,43,0.055)',
  '--app-surface-strong': 'rgba(32,35,43,0.09)',
  '--app-surface-soft': 'rgba(32,35,43,0.035)',
  '--app-input': '#ffffff',
  '--app-border': 'rgba(32,35,43,0.11)',
  '--app-border-soft': 'rgba(32,35,43,0.07)',
  '--app-text': '#2f3238',
  '--app-text-muted': '#626772',
  '--app-text-subtle': '#8b909b',
  '--app-shadow': '0 18px 60px rgba(25,28,36,0.12)',
  '--landing-primary-bg': '#30343b',
  '--landing-primary-fg': '#ffffff',
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
    `color-mix(in srgb, ${accentColor} 64%, #f2f2f3 36%)`,
  );
  root.style.setProperty(
    '--app-accent-soft',
    `color-mix(in srgb, ${accentColor} 7%, transparent)`,
  );

  Object.entries(tokens).forEach(([token, value]) => {
    root.style.setProperty(token, value);
  });
}
