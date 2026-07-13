import type { CursorStyle } from '../../types';
import { SPRITE_SVGS, svgToDataUrl, type SpriteName } from '../../assets/easter/sprites';

/**
 * Cute mouse-cursor easter egg. Applies a `cursor: url(<svg-data-url>) hx hy, auto`
 * rule to the document root so the whole app picks it up. `default` removes the
 * override entirely (restores the OS/theme cursor).
 *
 * Kept deliberately small (32px sprites) so browsers accept them as cursors —
 * Chromium rejects cursor images wider than 128px and prefers <=32px.
 */

export interface CursorOption {
  value: CursorStyle;
  label: string;
  /** Sprite used for the swatch/preview (undefined for the OS default). */
  sprite?: SpriteName;
}

export const CURSOR_OPTIONS: CursorOption[] = [
  { value: 'default', label: 'System default' },
  { value: 'cat', label: 'Cat', sprite: 'cat' },
  { value: 'butterfly', label: 'Monarch butterfly', sprite: 'butterfly' },
  { value: 'panda', label: 'Panda', sprite: 'panda' },
  { value: 'ladybug', label: 'Ladybug', sprite: 'ladybug' },
  { value: 'fox', label: 'Fox', sprite: 'fox' },
];

/** Cursor hotspot per sprite (roughly the visual "point" of the sprite). */
const HOTSPOTS: Record<SpriteName, [number, number]> = {
  cat: [16, 6],
  butterfly: [16, 16],
  panda: [16, 6],
  ladybug: [16, 6],
  fox: [16, 6],
};

const STYLE_ELEMENT_ID = 'easter-cursor-style';

/** Build the CSS `cursor` value (exported for testing / reuse). */
export function cursorCssValue(style: CursorStyle): string | null {
  if (style === 'default') return null;
  const sprite = style as SpriteName;
  const url = svgToDataUrl(SPRITE_SVGS[sprite]);
  const [hx, hy] = HOTSPOTS[sprite] ?? [16, 6];
  return `url("${url}") ${hx} ${hy}, auto`;
}

/**
 * Apply (or clear) the cute cursor globally. Uses an injected <style> targeting
 * everything under <html> with `!important` so it beats element-level cursor
 * rules (buttons, links, inputs) — the whole point of the egg is a consistent
 * cute pointer everywhere.
 */
export function applyCursorStyle(style: CursorStyle): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  const value = cursorCssValue(style);
  if (!value) {
    existing?.remove();
    document.documentElement.classList.remove('easter-cursor');
    return;
  }
  const el = (existing as HTMLStyleElement) ?? document.createElement('style');
  el.id = STYLE_ELEMENT_ID;
  el.textContent = `html.easter-cursor, html.easter-cursor * { cursor: ${value} !important; }`;
  if (!existing) document.head.appendChild(el);
  document.documentElement.classList.add('easter-cursor');
}
