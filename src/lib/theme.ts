import type { Settings } from '../types';

// Compute a readable foreground (black/white) for a given hex background.
function contrastColor(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length !== 6) return '#ffffff';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // Relative luminance
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#11211f' : '#ffffff';
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  if (c.length !== 6) return `rgba(47,143,131,${alpha})`;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Apply theme, accent, density and font scale to the document root. */
export function applyTheme(settings: Settings) {
  const root = document.documentElement;
  root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-density', settings.densityMode);
  root.style.setProperty('--accent', settings.accentColor);
  root.style.setProperty('--accent-fg', contrastColor(settings.accentColor));
  root.style.setProperty('--accent-soft', hexToRgba(settings.accentColor, settings.theme === 'dark' ? 0.22 : 0.12));
  root.style.fontSize = `${Math.round(settings.fontScale * 16)}px`;
}

export const ACCENT_PRESETS = [
  '#2f8f83', // teal (clinical)
  '#3b7dd8', // blue
  '#7a5cc3', // violet
  '#c2566e', // rose
  '#c77d33', // amber
  '#3f9d54', // green
  '#5b6b7a', // slate
];
