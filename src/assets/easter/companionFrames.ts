/**
 * Multi-frame pixel sprites for the walking-companion easter egg.
 *
 * Unlike the single front-facing face sprites in `sprites.ts` (used by the
 * cursor picker + disco cats), the companion now has a *side-view* critter with
 * genuine multi-frame animation: a 4-frame walk cycle (legs actually swing), a
 * gentle 2-frame idle breathe, a 2-frame sleep breathe, and a 2-frame annoyed
 * reaction. Frames are generated from a tiny parametric SVG builder so they stay
 * inline (no binary PNGs, fully offline) yet give a real "walk cycle" feel.
 *
 * Everything here is pure/deterministic — the builder takes a palette + pose and
 * returns an `<svg>` string, so the frame catalogue can be unit-tested and the
 * data-URLs are precomputed once at module load.
 */

import type { CompanionCharacter } from '../../types';

/** The distinct animation states the companion can be in. */
export type CompanionState = 'walk' | 'idle' | 'sleep' | 'annoyed';

interface Palette {
  body: string;
  belly: string;
  ear: string;
  dark: string;
  cheek: string;
  /** Panda-style dark eye patch (else a plain eye is drawn). */
  patch?: string;
  /** Rounded ears (panda) vs pointy ears (cat/fox). */
  roundEar?: boolean;
  /** Light tail tip (fox). */
  tailTip?: string;
}

const PALETTES: Record<CompanionCharacter, Palette> = {
  cat: {
    body: '#f6b26b',
    belly: '#ffe0c0',
    ear: '#f0a04b',
    dark: '#3b2a20',
    cheek: '#f7a1a1',
  },
  panda: {
    body: '#fdfdfd',
    belly: '#ffffff',
    ear: '#2f2a2a',
    dark: '#2f2a2a',
    cheek: '#f7a1a1',
    patch: '#2f2a2a',
    roundEar: true,
  },
  fox: {
    body: '#ee8b4f',
    belly: '#fff0e6',
    ear: '#e8743b',
    dark: '#2f2118',
    cheek: '#f7a1a1',
    tailTip: '#fff0e6',
  },
};

type Eyes = 'open' | 'closed' | 'angry';

interface LegPose {
  frontDx: number;
  backDx: number;
  frontLift: number;
  backLift: number;
}

interface Pose {
  /** Whole-body vertical bob (px, negative = up). */
  bob: number;
  /** Head centre y. */
  headY: number;
  /** Body ellipse vertical radius (breathing). */
  bodyRy: number;
  eyes: Eyes;
  /** Legs pose, or 'tucked' when lying down asleep. */
  legs: LegPose | 'tucked';
  /** Show the little red "anger" vein mark. */
  mark?: boolean;
  /** Lying down (sleep): flatten + drop the whole critter. */
  lying?: boolean;
}

const n = (v: number) => Math.round(v * 100) / 100;

function legRect(x: number, dx: number, lift: number, fill: string): string {
  const top = 24;
  const bottom = 29 - lift;
  const h = Math.max(1.5, bottom - top);
  return `<rect x='${n(x + dx - 1.4)}' y='${top}' width='2.8' height='${n(h)}' rx='1.1' fill='${fill}'/>`;
}

function buildSprite(pal: Palette, pose: Pose): string {
  const bob = pose.bob;
  const bodyCy = (pose.lying ? 22 : 18) + bob;
  const headY = pose.headY + bob;
  const parts: string[] = [];

  // --- Legs / feet (behind the body) ---
  if (pose.legs === 'tucked') {
    // Curled up: little paw nubs peeking out under the body.
    parts.push(
      `<ellipse cx='9' cy='${n(26 + bob)}' rx='2.2' ry='1.4' fill='${pal.body}'/>`,
      `<ellipse cx='19' cy='${n(26.5 + bob)}' rx='2.4' ry='1.5' fill='${pal.body}'/>`,
    );
  } else {
    const darkFoot = pal.roundEar ? pal.dark : pal.ear;
    parts.push(
      legRect(11, pose.legs.backDx, pose.legs.backLift, darkFoot),
      legRect(19, pose.legs.frontDx, pose.legs.frontLift, darkFoot),
    );
  }

  // --- Tail (back / left side) ---
  const tailY = bodyCy;
  parts.push(
    `<path d='M6 ${n(tailY)} Q-0.5 ${n(tailY - 5)} 3 ${n(tailY - 11)} Q6 ${n(tailY - 6)} 8.5 ${n(tailY - 2)} Z' fill='${pal.body}'/>`,
  );
  if (pal.tailTip) {
    parts.push(`<circle cx='2.6' cy='${n(tailY - 10)}' r='2' fill='${pal.tailTip}'/>`);
  }

  // --- Body ---
  parts.push(
    `<ellipse cx='14' cy='${n(bodyCy)}' rx='9.5' ry='${n(pose.bodyRy)}' fill='${pal.body}'/>`,
    `<ellipse cx='15.5' cy='${n(bodyCy + 2)}' rx='6' ry='3' fill='${pal.belly}' opacity='0.85'/>`,
  );

  // --- Ears ---
  if (pal.roundEar) {
    parts.push(
      `<circle cx='22.5' cy='${n(headY - 4.4)}' r='2.5' fill='${pal.ear}'/>`,
      `<circle cx='26' cy='${n(headY - 4.8)}' r='2.5' fill='${pal.ear}'/>`,
    );
  } else {
    parts.push(
      `<path d='M21.5 ${n(headY - 3.5)} L22.5 ${n(headY - 9)} L25.5 ${n(headY - 4)} Z' fill='${pal.ear}'/>`,
      `<path d='M25 ${n(headY - 4)} L27.5 ${n(headY - 9)} L28.5 ${n(headY - 3.5)} Z' fill='${pal.ear}'/>`,
    );
  }

  // --- Head ---
  parts.push(`<circle cx='24' cy='${n(headY)}' r='5.5' fill='${pal.body}'/>`);
  // Muzzle + nose (front / right)
  parts.push(
    `<ellipse cx='27.2' cy='${n(headY + 1.6)}' rx='2.4' ry='1.9' fill='${pal.belly}' opacity='0.9'/>`,
    `<circle cx='29' cy='${n(headY + 0.9)}' r='0.9' fill='${pal.dark}'/>`,
  );

  // Panda eye patch behind the eye.
  if (pal.patch) {
    parts.push(`<ellipse cx='24.6' cy='${n(headY - 0.2)}' rx='2.3' ry='2.7' fill='${pal.patch}'/>`);
  }

  // --- Eyes ---
  if (pose.eyes === 'open') {
    parts.push(
      `<circle cx='25' cy='${n(headY - 0.4)}' r='1.4' fill='${pal.dark}'/>`,
      `<circle cx='24.6' cy='${n(headY - 0.9)}' r='0.45' fill='#fff'/>`,
    );
  } else if (pose.eyes === 'closed') {
    parts.push(
      `<path d='M23.4 ${n(headY - 0.2)} Q25 ${n(headY + 1.4)} 26.6 ${n(headY - 0.2)}' stroke='${pal.dark}' stroke-width='1' fill='none' stroke-linecap='round'/>`,
    );
  } else {
    // angry: a downward brow slash + a squinting eye
    parts.push(
      `<path d='M23.2 ${n(headY - 1.9)} L26.2 ${n(headY - 0.3)}' stroke='${pal.dark}' stroke-width='1.2' stroke-linecap='round'/>`,
      `<circle cx='25' cy='${n(headY + 0.7)}' r='1.2' fill='${pal.dark}'/>`,
    );
  }

  // --- Cheek blush ---
  parts.push(
    `<ellipse cx='22' cy='${n(headY + 2.6)}' rx='1.4' ry='0.9' fill='${pal.cheek}' opacity='0.55'/>`,
  );

  // --- Anger vein mark ---
  if (pose.mark) {
    parts.push(
      `<path d='M27.5 7 l1.6 1.6 m0 -1.6 l-1.6 1.6 M30 9 l1.4 1.4 m0 -1.4 l-1.4 1.4' stroke='#e0564f' stroke-width='0.9' stroke-linecap='round'/>`,
    );
  }

  return `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${parts.join('')}</svg>`;
}

// --- Pose presets ---

const WALK_LEGS: LegPose[] = [
  { frontDx: 2, backDx: -2, frontLift: 0, backLift: 0 },
  { frontDx: 0, backDx: 0, frontLift: 2, backLift: 0 },
  { frontDx: -2, backDx: 2, frontLift: 0, backLift: 0 },
  { frontDx: 0, backDx: 0, frontLift: 0, backLift: 2 },
];

function walkPoses(bounce: boolean): Pose[] {
  return WALK_LEGS.map((legs, i) => ({
    bob: bounce && (i === 1 || i === 3) ? -1 : 0,
    headY: 12 + (bounce && (i === 1 || i === 3) ? -1 : 0),
    bodyRy: 6.5,
    eyes: 'open' as Eyes,
    legs,
  }));
}

const NEUTRAL_LEGS: LegPose = { frontDx: 0, backDx: 0, frontLift: 0, backLift: 0 };

const IDLE_POSES: Pose[] = [
  { bob: 0, headY: 12, bodyRy: 6.4, eyes: 'open', legs: NEUTRAL_LEGS },
  { bob: 0, headY: 12, bodyRy: 6.9, eyes: 'open', legs: NEUTRAL_LEGS },
];

const SLEEP_POSES: Pose[] = [
  { bob: 2, headY: 17, bodyRy: 5.2, eyes: 'closed', legs: 'tucked', lying: true },
  { bob: 2, headY: 16.6, bodyRy: 5.9, eyes: 'closed', legs: 'tucked', lying: true },
];

const ANNOYED_POSES: Pose[] = [
  { bob: 0, headY: 12, bodyRy: 6.6, eyes: 'angry', legs: NEUTRAL_LEGS, mark: true },
  { bob: -1, headY: 11, bodyRy: 6.6, eyes: 'angry', legs: NEUTRAL_LEGS, mark: false },
];

export interface CompanionFrameSet {
  /** Bouncy walk cycle (used normally). */
  walk: string[];
  /** Calmer walk cycle (legs move, no vertical bounce) for reduced motion. */
  walkCalm: string[];
  idle: string[];
  sleep: string[];
  annoyed: string[];
}

function buildFrameSet(pal: Palette): CompanionFrameSet {
  return {
    walk: walkPoses(true).map((p) => buildSprite(pal, p)),
    walkCalm: walkPoses(false).map((p) => buildSprite(pal, p)),
    idle: IDLE_POSES.map((p) => buildSprite(pal, p)),
    sleep: SLEEP_POSES.map((p) => buildSprite(pal, p)),
    annoyed: ANNOYED_POSES.map((p) => buildSprite(pal, p)),
  };
}

/** Raw `<svg>` frame strings keyed by character (exported for tests). */
export const COMPANION_FRAMES: Record<CompanionCharacter, CompanionFrameSet> = {
  cat: buildFrameSet(PALETTES.cat),
  panda: buildFrameSet(PALETTES.panda),
  fox: buildFrameSet(PALETTES.fox),
};

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

type FrameUrlSet = {
  walk: string[];
  walkCalm: string[];
  idle: string[];
  sleep: string[];
  annoyed: string[];
};

function toUrlSet(set: CompanionFrameSet): FrameUrlSet {
  return {
    walk: set.walk.map(svgToDataUrl),
    walkCalm: set.walkCalm.map(svgToDataUrl),
    idle: set.idle.map(svgToDataUrl),
    sleep: set.sleep.map(svgToDataUrl),
    annoyed: set.annoyed.map(svgToDataUrl),
  };
}

/** Precomputed data-URL frames, ready to drop into an `<img src>`. */
export const COMPANION_FRAME_URLS: Record<CompanionCharacter, FrameUrlSet> = {
  cat: toUrlSet(COMPANION_FRAMES.cat),
  panda: toUrlSet(COMPANION_FRAMES.panda),
  fox: toUrlSet(COMPANION_FRAMES.fox),
};

/**
 * Pick the data-URL frame list for a given character + state, honouring the
 * reduced-motion preference (calmer walk). Pure so it is unit-testable.
 */
export function framesFor(
  character: CompanionCharacter,
  state: CompanionState,
  reducedMotion: boolean,
): string[] {
  const set = COMPANION_FRAME_URLS[character];
  if (state === 'walk') return reducedMotion ? set.walkCalm : set.walk;
  return set[state];
}

/** Milliseconds per frame for each state (walk slows down under reduced motion). */
export function frameDurationMs(state: CompanionState, reducedMotion: boolean): number {
  switch (state) {
    case 'walk':
      return reducedMotion ? 240 : 130;
    case 'idle':
      return 900;
    case 'sleep':
      return 1100;
    case 'annoyed':
      return 150;
    default:
      return 200;
  }
}
