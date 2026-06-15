// Swappable visual themes. Aurora is the original look; Broadcast and Cinema drop the
// AI-template tells (violet→cyan gradient, aurora glow, glassmorphism) for a domain-specific,
// flat-instrument feel. The choice persists locally and applies to every window (main + popout).
export type ThemeName = 'aurora' | 'broadcast' | 'cinema' | 'mono' | 'tactical';
const VALID: ThemeName[] = ['aurora', 'broadcast', 'cinema', 'mono', 'tactical'];

export const THEMES: { id: ThemeName; label: string }[] = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'cinema', label: 'Cinema' },
  { id: 'mono', label: 'Mono' },
  { id: 'tactical', label: 'Tactical' },
];

const KEY = 'xyst-theme';

export function getTheme(): ThemeName {
  const v = localStorage.getItem(KEY) as ThemeName | null;
  return v && VALID.includes(v) ? v : 'aurora';
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
