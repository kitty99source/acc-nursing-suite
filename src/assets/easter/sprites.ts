/**
 * Hand-authored, tiny pixel-ish SVG sprites for the "Fun" easter eggs.
 *
 * These are intentionally kept as inline SVG strings (no binary PNGs) so the
 * whole suite stays a single, offline, inlined build with zero extra network
 * assets. Each sprite is a 32x32 viewBox, front-facing, cute, and uses warm
 * palette colours that read fine on both light and dark themes (they carry
 * their own fills rather than relying on theme tokens).
 *
 * The same sprite family is reused for the cursor picker and the walking
 * companion, so a user's chosen companion visually matches the cursor set.
 */

export type SpriteName = 'cat' | 'butterfly' | 'panda' | 'ladybug' | 'fox';

/** Raw <svg> markup keyed by sprite. Single-quoted attrs keep data-URL encoding simple. */
export const SPRITE_SVGS: Record<SpriteName, string> = {
  cat: `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
    <path d='M7 11 L10 3 L15 12 Z' fill='#f0a04b'/>
    <path d='M25 11 L22 3 L17 12 Z' fill='#f0a04b'/>
    <path d='M9 9 L10.5 5 L12.5 9.5 Z' fill='#ffd9a8'/>
    <path d='M23 9 L21.5 5 L19.5 9.5 Z' fill='#ffd9a8'/>
    <circle cx='16' cy='18' r='9.5' fill='#f6b26b'/>
    <circle cx='12.3' cy='17' r='1.7' fill='#3b2a20'/>
    <circle cx='19.7' cy='17' r='1.7' fill='#3b2a20'/>
    <circle cx='11.8' cy='16.4' r='0.5' fill='#fff'/>
    <circle cx='19.2' cy='16.4' r='0.5' fill='#fff'/>
    <path d='M14.8 20 L17.2 20 L16 21.6 Z' fill='#c9705a'/>
    <path d='M6 18 H10 M6 20 H10 M22 18 H26 M22 20 H26' stroke='#7a5236' stroke-width='0.7' stroke-linecap='round'/>
    <ellipse cx='10.5' cy='20.5' rx='1.6' ry='1' fill='#f7a1a1' opacity='0.7'/>
    <ellipse cx='21.5' cy='20.5' rx='1.6' ry='1' fill='#f7a1a1' opacity='0.7'/>
  </svg>`,
  butterfly: `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
    <path d='M16 6 Q6 3 4 12 Q3 19 15 16 Z' fill='#f2994a'/>
    <path d='M16 6 Q26 3 28 12 Q29 19 17 16 Z' fill='#f2994a'/>
    <path d='M16 16 Q6 17 5 24 Q6 29 15 22 Z' fill='#f6b26b'/>
    <path d='M16 16 Q26 17 27 24 Q26 29 17 22 Z' fill='#f6b26b'/>
    <circle cx='9' cy='11' r='1.6' fill='#fff3e0'/>
    <circle cx='23' cy='11' r='1.6' fill='#fff3e0'/>
    <rect x='15.2' y='7' width='1.6' height='18' rx='0.8' fill='#5a3a24'/>
    <path d='M15.5 7 Q13 3 12 4 M16.5 7 Q19 3 20 4' stroke='#5a3a24' stroke-width='0.8' fill='none' stroke-linecap='round'/>
  </svg>`,
  panda: `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
    <circle cx='9' cy='9' r='4' fill='#2f2a2a'/>
    <circle cx='23' cy='9' r='4' fill='#2f2a2a'/>
    <circle cx='16' cy='18' r='9.5' fill='#fdfdfd'/>
    <ellipse cx='11.5' cy='17' rx='2.6' ry='3.1' fill='#2f2a2a'/>
    <ellipse cx='20.5' cy='17' rx='2.6' ry='3.1' fill='#2f2a2a'/>
    <circle cx='11.9' cy='17.3' r='1.1' fill='#fff'/>
    <circle cx='20.1' cy='17.3' r='1.1' fill='#fff'/>
    <ellipse cx='16' cy='21' rx='1.7' ry='1.2' fill='#2f2a2a'/>
    <ellipse cx='10.5' cy='21.5' rx='1.5' ry='0.9' fill='#f7a1a1' opacity='0.6'/>
    <ellipse cx='21.5' cy='21.5' rx='1.5' ry='0.9' fill='#f7a1a1' opacity='0.6'/>
  </svg>`,
  ladybug: `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
    <circle cx='16' cy='10' r='4' fill='#2b2b2b'/>
    <circle cx='13.5' cy='9' r='0.9' fill='#fff'/>
    <circle cx='18.5' cy='9' r='0.9' fill='#fff'/>
    <path d='M16 6 Q13 3 12 4 M16 6 Q19 3 20 4' stroke='#2b2b2b' stroke-width='0.8' fill='none' stroke-linecap='round'/>
    <ellipse cx='16' cy='20' rx='10' ry='9' fill='#e34f4f'/>
    <path d='M16 11 V29' stroke='#2b2b2b' stroke-width='1.1'/>
    <circle cx='11' cy='17' r='1.5' fill='#2b2b2b'/>
    <circle cx='21' cy='17' r='1.5' fill='#2b2b2b'/>
    <circle cx='11.5' cy='23' r='1.5' fill='#2b2b2b'/>
    <circle cx='20.5' cy='23' r='1.5' fill='#2b2b2b'/>
    <ellipse cx='16' cy='13.5' rx='9.5' ry='2.4' fill='#fff' opacity='0.18'/>
  </svg>`,
  fox: `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
    <path d='M6 8 L11 4 L14 12 Z' fill='#e8743b'/>
    <path d='M26 8 L21 4 L18 12 Z' fill='#e8743b'/>
    <path d='M8.5 7.5 L11 5 L12.5 10 Z' fill='#fff0e6'/>
    <path d='M23.5 7.5 L21 5 L19.5 10 Z' fill='#fff0e6'/>
    <path d='M6 13 Q16 9 26 13 Q22 24 16 26 Q10 24 6 13 Z' fill='#ee8b4f'/>
    <path d='M11 19 Q16 17 21 19 Q19 25 16 26 Q13 25 11 19 Z' fill='#fff0e6'/>
    <circle cx='12.5' cy='16' r='1.6' fill='#2f2118'/>
    <circle cx='19.5' cy='16' r='1.6' fill='#2f2118'/>
    <path d='M14.9 21 L17.1 21 L16 22.6 Z' fill='#2f2118'/>
  </svg>`,
};

/** Compact single-line SVG (strips the pretty-print whitespace) for data URLs. */
export function spriteMarkup(name: SpriteName): string {
  return SPRITE_SVGS[name].replace(/\s+/g, ' ').trim();
}

/** Encode an SVG string as a `data:image/svg+xml` URL usable in CSS/img src. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}
