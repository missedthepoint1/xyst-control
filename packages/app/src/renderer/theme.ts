// Swappable visual themes. The default `studio` is a flat instrument look (single cyan-teal
// accent, matte graphite, no glow/gradient/glass) built for live production. `aurora` is a
// refined dark-modern alternate (single violet accent, no rainbow). The choice persists
// locally and applies to every window (main + popout).
export type ThemeName = 'studio' | 'aurora';
const VALID: ThemeName[] = ['studio', 'aurora'];

export const THEMES: { id: ThemeName; label: string }[] = [
  { id: 'studio', label: 'Studio' },
  { id: 'aurora', label: 'Aurora' },
];

const KEY = 'xyst-theme';

export function getTheme(): ThemeName {
  const v = localStorage.getItem(KEY) as ThemeName | null;
  // Migrate retired themes (broadcast/cinema/mono/tactical) and anything unknown to the default.
  return v && VALID.includes(v) ? v : 'studio';
}

export function applyTheme(theme: ThemeName = getTheme()): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: ThemeName): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

// Keep all windows in sync — e.g. switching the theme in the control window while the popout is open.
window.addEventListener('storage', (e) => { if (e.key === KEY) applyTheme(); });
