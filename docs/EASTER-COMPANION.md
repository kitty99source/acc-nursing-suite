# Easter egg #3 — Walking Companion Sprite (A–Z design)

A tiny cute sprite (cat / panda / fox) that **walks along the edges of the UI
chrome** — the top of the sidebar, the top bar, and the tops of cards — as the
user works. Think of the iPhone Dynamic-Island critters, but crawling along the
real DOM boxes of the Admin Suite. Purely a mood-booster; never blocks work.

This doc is the source of truth for the behaviour. The v1 implementation
(`src/components/easter/Companion.tsx` + `src/lib/easter/pathing.ts`) matches
this, with the explicitly-listed v1 cuts at the bottom.

---

## A. Goal & non-goals

- **Goal:** a delightful, low-cost, non-intrusive companion that appears to walk
  along the app's real layout edges and survives navigation between modules.
- **Non-goals:** no gameplay, no physics sim, no pathfinding maze solving, no
  interaction/click targets, no sound, no persistence of a "pet state" across
  reloads (v1). It must never intercept clicks or steal focus.

## B. Spawn / despawn

- Controlled by `settings.companionEnabled` (persisted in the autosaved blob).
- Also gated by an internal readiness check: only mounts real DOM work once the
  main app shell is rendered (App already guards for `ready`/`locked`).
- Despawn = unmount cleanly: cancel the rAF loop, disconnect observers, remove
  listeners. No residue.

## C. Which sprite

- Reuses the cute **cursor sprite family** (`src/assets/easter/sprites.ts`) so
  the companion visually matches the chosen cursor set. Companion characters are
  a subset: `cat | panda | fox` (`settings.companionCharacter`).
- Rendered as a single `<img>` with an SVG data-URL — no spritesheet needed;
  the "walk" is a CSS bob (`.easter-companion-sprite`) plus horizontal flip for
  travel direction.

## D. The "walkable world" — how edges are found

- A **walkable segment** is the *top edge* of a laid-out box: `{ x1, x2, y }`.
- v1 queries a small, curated set of elements via `data-companion-edge`
  attributes we add to stable chrome (top bar, sidebar header, main content
  cards get them opportunistically) **plus** a generic fallback: the top bar
  `<header>` and the sidebar `<aside>`.
- For each element we take `getBoundingClientRect()` and produce a segment along
  its top edge, trimmed by a small inset so the sprite sits nicely on the edge.
- Segments shorter than a minimum width are discarded (`pruneSegments`).
- All geometry math lives in **pure, unit-tested helpers** in
  `src/lib/easter/pathing.ts` (`rectToTopEdge`, `pruneSegments`,
  `nearestSegment`, `stepAlong`, `pickNextSegment`).

## E. Pathing / movement

- One `requestAnimationFrame` loop. Each frame:
  1. Advance the sprite along its current segment by `speed * dt` in the current
     direction (`stepAlong`).
  2. On reaching a segment end, pick the next segment (`pickNextSegment`:
     nearest segment whose start is close to the current end, else the nearest
     overall, else idle) and flip facing direction.
  3. Occasionally (small random chance) enter a brief **idle** state (sit + look
     around) before resuming — see "cuteness" below.
- Movement is frame-time-scaled (`dt`) so it's speed-consistent regardless of
  refresh rate.

## F. Reacting to layout changes / scroll / resize

- A `ResizeObserver` on `document.body` + a `window` `resize` listener +
  `scroll` (capture) listener trigger a **re-measure** of segments (throttled to
  once per rAF frame via a dirty flag).
- Because segments are recomputed from live `getBoundingClientRect()`, scrolling
  and layout shifts are naturally handled: the sprite re-snaps to the nearest
  valid segment (`nearestSegment`) if its current one vanished.
- We use viewport (client) coordinates and `position: fixed`, so the sprite
  tracks chrome that stays put and glides when content reflows.

## G. Navigation between modules

- The companion lives in `App` (outside the module switch), so switching modules
  never unmounts it. Module changes just change which cards exist → the next
  re-measure picks up the new edges. The sprite "follows across pages" for free.

## H. Modals / Help / Helper Mode / overlays

- The companion renders at a **z-index below modals** (`z-[45]`, modals are 50+)
  so it never floats over dialogs, the Help Center, lock screen, or the disco
  overlay.
- It only measures always-present chrome (top bar / sidebar) plus opted-in
  cards; it does not try to walk on modal chrome. When a modal is open the
  sprite keeps ambling along the background chrome underneath, which reads fine
  since it's behind the modal.
- Helper Mode tooltips are unaffected (companion is `aria-hidden`, no pointer
  events).

## I. Performance budget

- **Exactly one** rAF loop for the whole feature.
- Loop **pauses when the tab is hidden** (`document.visibilitychange`) and when
  the feature is disabled.
- Re-measure is throttled to at most once per frame and only when a dirty flag
  is set by observers (no measuring every frame).
- DOM writes per frame are limited to a single `transform` on the sprite (GPU
  compositable; no layout thrash).

## J. Accessibility

- Sprite container is `aria-hidden="true"` and `pointer-events: none` — it never
  steals focus or clicks, never appears in the a11y tree.
- Respects `prefers-reduced-motion: reduce`: the bob animation is disabled in
  CSS and movement speed is dropped (calm glide), never removed jarringly.
- No flashing; single soft drop-shadow only.

## K. Persistence

- v1 persists only the **on/off** and **character** choice (in Settings).
- Live position is **not** persisted across reloads (would be more surprising
  than delightful, and coordinates are viewport-relative). Deferred to future.

## L. Edge cases

- **Zoom / small windows:** everything is measured from live rects, so browser
  zoom and tiny windows still yield valid segments; if no valid segment exists
  the sprite idles at the top-left safe corner.
- **Print:** `@media print` hides it (decorative). (v1: relies on it being a
  fixed decorative layer; a print rule is added.)
- **Offline:** no network dependency at all (inline SVG), so offline is a no-op.
- **Reduced motion / no segments:** graceful idle.
- **RTL:** facing/flip is direction-based, works either way.

## M. Cuteness (things the user didn't ask for but make it better)

Chosen for v1 (kept small, not over-scoped):
- **Idle animations:** occasional pause to sit and "look around".
- **Rare wave/blink:** small chance of a hop while idling.
- **Avoid covering primary CTAs:** sprite walks *on top edges* of chrome, not
  over button faces; z-index sits under modals.
- **Soft shadow** under the sprite for grounding.

Deferred (documented, not built in v1): day/night tint, reacting to save events,
chasing the cursor, sleeping when idle for a long time.

---

## v1 known limitations (companion follow-up)

1. Walkable edges in v1 are the **top bar + sidebar header** (always present)
   plus any element tagged `data-companion-edge`; general card edges are opt-in
   rather than auto-discovered, to keep measurement cheap and predictable.
2. No live-position persistence across reloads.
3. The sprite walks along **top edges** only (not down vertical edges / around
   full box perimeters) in v1 — simplest pathing that still reads as "walking on
   the UI".
4. When a large modal is open, the companion keeps walking on the background
   chrome (behind the modal) rather than pausing; acceptable since it's occluded.
5. Idle/wave behaviours are lightweight CSS/state only; no spritesheet frames.
