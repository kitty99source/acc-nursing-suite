# Admin Suite — Gamification / Easter Eggs Design Brief

**Status:** design-only (no full game system yet)  
**Scope:** ACC Admin Suite only  
**Audience:** pixel artists + implementers  
**Date:** 2026-07-27  
**Builds on:** [`docs/EASTER-COMPANION.md`](./EASTER-COMPANION.md) (walking companion v1–v3)

This brief is the source of truth for pixel dimensions, architecture sketch, MVP phases, AI art tooling, and open questions. Prefer committed local assets over any runtime cloud dependency (offline-first hospital constraint).

---

## 1. Current implementation (measured)

### 1.1 Walking companion (live today)

| Layer | Value | Source |
| --- | --- | --- |
| Authoring canvas | **32×32** SVG `viewBox` / `width`/`height` | `src/assets/easter/companionFrames.ts` |
| On-screen CSS size | **30×30** px (`SPRITE_SIZE = 30`) | `src/components/easter/Companion.tsx` |
| Scale factor | ~**0.9375×** (30/32) — slightly soft | — |
| Rendering | `imageRendering: 'pixelated'` + drop-shadow | Companion `<img>` inline style |
| Frames | walk×4, walkCalm×4, idle×2, sleep×2, annoyed×2 | parametric SVG builder → data-URLs |
| Characters | `cat` \| `panda` \| `fox` | `settings.companionCharacter` |
| Mount | `<Companion />` in `App.tsx` (outside module switch) | z-index `48`, under modals |
| Pathing | DOM edge discovery + path graph + hop arcs | `pathing.ts` + `companionBehavior.ts` |
| Opt-in markers | `[data-companion-edge]`, `[data-companion-ledge="bottom"]`, `[data-companion-skip]` | Companion measure pass |

Related (same 32×32 family, front-facing):

| Use | Display size |
| --- | --- |
| Disco cats | 32×32 / center 40×40 |
| Cursor picker thumbs | 24×24 |
| Cute cursors | CSS cursor hotspot (separate) |

Front-facing static sprites: `src/assets/easter/sprites.ts` (also 32×32 SVG).

### 1.2 Bottom-left Tamagotchi slot (empty today)

**Where in the code:** `src/components/Sidebar.tsx`

Layout of `<aside className="… w-64 … flex flex-col">`:

1. **Header** — NS badge + “ACC District Nursing / Admin Suite”
2. **`<nav className="flex-1 overflow-y-auto p-2">`** — module links (grows; leftover height is the “empty” region the user circled)
3. **Footer** — currently:
   ```text
   100% offline · no network
   v{version} · {build date}
   ```
   (`border-t`, `p-3`, muted text)

**Insert point for the Tamagotchi panel:** between `</nav>` and the footer `<div className="p-3 text-xs border-t" …>` (after ~line 202). That keeps the footer chrome stable and fills the unused flex space above “offline / version”.

**Geometry budget (desktop):**

| Constraint | px |
| --- | --- |
| Sidebar width (`w-64`) | **256** |
| Horizontal padding (typical `p-3` = 12×2) | content ~**232** |
| Footer block height (2 text lines + padding) | ~**52–60** |
| Comfortable companion stage above footer | **120–160** tall × **full content width** |

On short viewports, stage may shrink; never cover nav labels (nav scrolls independently).

---

## 2. Exact pixel specs (author against these)

### 2.1 Tiny walking friends (main UI)

**Goal:** crisp nearest-neighbor at current “critter on the chrome” scale.

| Spec | Recommendation | Rationale |
| --- | --- | --- |
| **Author cell** | **32×32** px per frame | Matches today’s SVG canvas; readable at UI scale; PixelLab/Aseprite-friendly |
| **On-screen** | **32×32** CSS px (integer **1×**) | Fix `SPRITE_SIZE` 30→32 so pixels land on device pixels |
| Optional tiny variant | Author **16×16**, display **32×32** (**2×**) | Chunkier “Game Boy” look if desired later |
| Max multi-char crowd | Keep each walker ≤32 CSS px; ≤3 simultaneous | Perf + chrome clutter |

**Sprite sheet layout (recommended):**

```
Row order (left → right): walk0 walk1 walk2 walk3 | idle0 idle1 | sleep0 sleep1 | jump0 jump1 | wave0
Cell: 32×32, 1px transparent gutters optional (or packed with no gutters if exporter is clean)
Facing: draw facing RIGHT; runtime flips with scaleX (already implemented)
```

**Frame checklist for artists:**

| State | Frames | Notes |
| --- | --- | --- |
| walk | 4 | Legs cycle; small bob OK |
| walkCalm | 4 *or* reuse walk without bob | Reduced-motion path |
| idle | 2 | Breathe / look |
| sleep | 2 | Lying / tucked paws |
| annoyed | 2 | Optional brow / vein |
| jump / hop | 2 | For border hops (stretch existing hop arc) |
| wave | 1–2 | Rare celebrate on XP ping |

**Export:** transparent PNG (preferred for new art) or SVG; commit under e.g. `src/assets/easter/pixel/{character}/`. No runtime fetch.

### 2.2 Large Tamagotchi companion (sidebar)

**Goal:** readable “pet stage” with biome backdrop + talk UI; Duolingo-adjacent dopamine, not toy junk.

| Spec | Recommendation | Rationale |
| --- | --- | --- |
| **Author character cell** | **64×64** px | Enough detail for accessories / emotions at sidebar scale |
| **On-screen character** | **128×128** CSS px (**2×** nearest-neighbor) | Hero pet without overflowing 256px sidebar |
| Compact mode (short height) | Display **96×96** (1.5× of 64 — avoid; prefer **64→128** or fallback **48→96**) | Prefer integer scales only: **48×48 → 96×96** as alternate pack |
| **Biome / stage canvas** | Author **112×80** or **232×120** (1× UI) | Stage behind sprite; can be 1× CSS (not necessarily pixel-scaled) |
| **Accessory overlays** | **64×64** aligned to character cell | Hats / scarves as separate layers |
| **Talk bubble** | Text UI (not pixel) | Keep copy readable; max ~2 lines |

**Integer scale rule:** only display at **1×, 2×, 3×, 4×** of authoring size with `image-rendering: pixelated` (and `-moz-crisp-edges` where needed). Never 30/32.

**Alternate authoring pack (if 64 feels heavy to draw):**

| Role | Author | Display |
| --- | --- | --- |
| Walker | 32×32 | 32×32 |
| Tamagotchi | 48×48 | 96×96 (2×) |
| Biome tiles | 16×16 | 32×32 tileset |

---

## 3. Creative north star (Duolingo-grade, not childish junk)

### 3.1 Tone

- **Adult competence + soft reward.** Warm steel / teal Admin Suite palette; pixel pets as *colleagues*, not cartoon babies.
- **Work is the gameplay loop.** Points come from real Admin Suite actions; fluff never gates clinical work.
- **Stable progression.** Slay-the-Spire *map feel* without permadeath: nodes unlock, never wipe. Missed days = pet naps, not punishment spirals.
- **Metaphor:** backlog “mobs,” milestone “bosses,” completed triage “heals” the party — flavor only; never scary copy in a clinical tool.

### 3.2 Signature loops

1. **Streak of usefulness** — “5 Review Queue accepts today” → soft chime + pet wave + XP (not a blocking modal).
2. **Cosmetic drip** — scarves, biomes, idle toys unlock; characters stay optional.
3. **Map of the job** — each module is a region; clearing a weekly milestone lights the next node.
4. **Sidebar pet** — biomes shift with time-of-day / workload; talk for FAQ + smart find; later optional AI (local policy TBD).

### 3.3 Top creative recommendations

1. **“District Care Crew”** — party of unlocked walkers who patrol chrome; Tamagotchi is the *home base* captain.
2. **Biome moods** — Calm Clinic / Inbox Storm / After-Hours Lamp — driven by queue depth + hour, never patient content.
3. **Boss milestones** — e.g. “Clear Compliance flags to 0,” “Export pack shipped,” “Backup done this week” — celebration toast + permanent map stamp.
4. **Encourage without nag** — pet lines are optional; Settings can mute speech balloons.
5. **Shared-folder cosmetics export** — JSON + asset ids in the autosave blob so two PCs stay in sync (same offline model as the rest of the suite).

---

## 4. Systems brainstorm

### 4.1 XP sources (map to real Admin Suite actions)

| Action (examples) | XP | Notes |
| --- | --- | --- |
| Accept / apply Review Queue letter | mid | Core daily loop |
| Resolve Compliance flag | mid–high | “Heal the ward” |
| Create / update patient or case (non-spam) | low | Debounce / once per entity per day |
| Log billing / approval row | low–mid | |
| Complete Export Center pack | high | Boss-lite |
| Successful backup / shared-folder sync | mid | Reliability praise |
| Use Package Calculator → save | low | |
| ACC Inbox triage step | mid | |
| Idle / open app only | **0** | No participation trophies |

**Anti-cheat / anti-annoyance:** daily soft caps; no XP for bulk-delete thrash; manager can disable entire Fun layer.

### 4.2 Rewards & cosmetics

- **Currency:** soft “stamps” or “tea leaves” (not money metaphors that feel odd in ACC).
- **Unlocks:** characters, walk accessories, Tamagotchi biomes, disco floor skins, cursor variants.
- **Multi-character:** up to 3 walkers on chrome; extras idle in Tamagotchi “party tray.”
- **Save/export:** cosmetics + XP in settings blob; optional “Fun profile” export JSON (no PHI).

### 4.3 Map nodes (module regions)

Stable node graph (illustrative):

```text
[Home / Dashboard] —— [Review Queue] —— [ACC Inbox]
        |                    |
   [Patients] —— [Approvals] —— [Billing]
        |                    |
   [Compliance] —— [Complex] —— [Declines]
        \                    /
         [Export] —— [Backup / Settings]
```

- Nodes unlock visually as modules are used; **never lock real navigation**.
- Boss nodes = weekly goals; failure to beat boss = node stays dim, progress kept.

### 4.4 Tamagotchi states

| State | Trigger | Visual |
| --- | --- | --- |
| Cheer | XP gain | Jump / sparkle |
| Focus | User in Review Queue | Sitting with clipboard prop |
| Nap | Idle / reduced motion | Sleep frames + soft zzz |
| Storm | High open queue count | Wind biome / determined face |
| Celebrate | Boss clear | Party hat accessory |

### 4.5 Companion queries (programmatic first)

Wire chat box to existing helpers — **no PHI logging**:

1. Reuse `filterFaq` / `FAQ_ENTRIES` (`src/lib/helpContent.ts`)
2. Module jump (“open Billing”) via existing navigate
3. Record lookup by **non-sensitive tokens only** (claim # patterns already in UI search) — never echo full names into a transcript store
4. Smarter-than-Ctrl+F: tag + synonym map over FAQ + Settings field labels + module titles
5. Future AI: opt-in, local-or-approved endpoint only; default off; transcripts never leave machine; strip patient fields before any prompt

### 4.6 Gaps the user didn’t list (must-haves)

| Concern | Proposal |
| --- | --- |
| **Manager off-switch** | Settings → Fun master toggle + optional `funLockedByPolicy` in blob |
| **Reduce motion** | Already partially done; extend to XP toasts + map animations |
| **Perf** | Cap walkers; one rAF; pause when hidden; no canvas full-screen by default |
| **No PHI in companion logs** | Persist only intent labels (`faq:faq-easter-eggs`), never query text with NHIs/names |
| **Accessibility** | Pet decorative `aria-hidden`; talk UI is a real focusable widget with Esc |
| **Print** | Hide all fun layers (`@media print` already hides companion/disco) |
| **Conflict with work clicks** | Keep overlay `pointer-events: none` except sprite/pet hit targets |
| **Tone safety** | No “you killed the patient” / medical failure jokes |

---

## 5. Collision / map approach (fits React UI)

### 5.1 Recommendation: **DOM hit targets + light overlay** (not a game canvas takeover)

The current companion already treats the UI as a walkable world via `getBoundingClientRect()` edges. Extend that model:

| Layer | Role |
| --- | --- |
| **Work UI** | Unchanged React modules; always clickable |
| **Markers** | `data-companion-edge`, `data-companion-platform`, `data-companion-solid`, `data-fun-node="review"` |
| **Walker layer** | Existing fixed overlay, `pointer-events: none`, sprite `auto` |
| **Optional debug** | Dev-only outline of segments (toggle in Settings) |
| **Map UI** | Separate “District Map” card/modal — node graph as SVG/DOM, not physics |

**Why not full-screen Canvas/WebGL for MVP:** breaks text selection, hurts a11y, fights modal stacking, harder to keep offline single-file calm. Canvas is OK later for *biome stage only* inside the sidebar pet panel (~232×140).

### 5.2 Collision markers (artist / implementer contract)

```html
<!-- Walkable ledge (top edge) -->
<section class="card" data-companion-edge>

<!-- Solid prop the walker can bump / sit on (future) -->
<div data-companion-solid data-companion-solid-shape="rect">

<!-- Explicit skip (modals already skipped via role=dialog) -->
<div data-companion-skip>
```

Hop/jump already exists as `hopArc` between segments — reuse for “jump” animation frames when distance > threshold.

### 5.3 Side-scroller fantasy vs reality

- **Fantasy:** whole site is a landscape.
- **Reality (MVP):** chrome edges + card tops *are* the landscape; modules change the “level geometry” via remeasure (already v3).
- **Later:** optional parallax strip under TopBar (purely decorative, non-interactive).

---

## 6. Architecture sketch

```text
settings.fun*
    ├── masterEnabled / companion / disco / tamagotchi / map
    ├── xp, stamps, unlocks[], equipped{}
    └── funLockedByPolicy?

lib/fun/
    ├── xp.ts              # pure: award rules, daily caps
    ├── unlocks.ts         # catalog + eligibility
    ├── mapGraph.ts        # stable nodes / edges
    └── companionSearch.ts # FAQ + module + safe lookup

components/easter/
    ├── Companion.tsx      # walkers (extend multi)
    ├── DiscoCats.tsx
    ├── TamagotchiDock.tsx # NEW — Sidebar slot
    └── DistrictMap.tsx    # NEW — optional modal/card

assets/easter/pixel/       # NEW — committed PNG sheets
```

**Persistence:** fun progress rides in the existing autosaved settings/blob (shared-folder sync). Never a separate cloud save.

---

## 7. MVP phases (later build — not this PR)

### Phase 0 — Art pack + measurement align (tiny)

- Align walker display to **32×32**.
- Document / folder for PNG sheets; one sample tabby walk cycle.
- Optional: empty `TamagotchiDock` placeholder in Sidebar (biome box + “Coming soon”) behind Settings flag.

### Phase 1 — Tamagotchi dock + talk (programmatic)

- Sidebar slot UI: 128×128 pet, biome, encourage button, search box → FAQ/module jump.
- No XP yet; reuses existing companion character frames scaled up *or* first 64×64 sheet.

### Phase 2 — XP + cosmetics drip

- Award XP on 3–5 high-value actions; unlock 1 accessory + 1 biome.
- Soft toast + pet cheer; master off-switch; reduce-motion path.

### Phase 3 — Multi-walker + map postcard

- Up to 3 chrome walkers; District Map modal with stable nodes (no death).
- Boss milestone of the week.

### Phase 4 — Optional AI talk

- Policy review first; local/approved only; PHI redaction; default off.

---

## 8. AI → pixel sprite research (2025–2026)

**Hard constraint for this product:** generate/edit assets on a **dev machine**, export PNG/SVG, **commit to repo**. Runtime Admin Suite must not call cloud APIs.

### 8.1 Tooling matrix

| Tool | What it’s good for | Automatable? | Offline / hospital fit |
| --- | --- | --- | --- |
| **[PixelLab](https://www.pixellab.ai/)** + [API](https://www.pixellab.ai/pixellab-api) / [docs](https://api.pixellab.ai/v2/docs) | Text→pixel, animate-with-text/skeleton, 4/8-dir characters, sidescroller tilesets, export ZIP | **High** via API / MCP (`https://api.pixellab.ai/mcp`) on **dev** machines | **Dev-time only.** Terms: you own outputs; don’t train other models on them; programmatic use via official API. Commit PNGs; never ship API keys in the suite. |
| **[Scenario](https://www.scenario.com/)** + Retro Diffusion (Plus / Tile / Animation) | Style-consistent pixel sheets; train custom model on your tabby; animated sheets | **High** (API + UI); best for *consistent cast* | Paid plans: commercial ownership of outputs (verify current ToS). Free = eval only. Dev-time cloud; commit results. |
| **Aseprite** + **[PixelAI](https://red335.itch.io/pixelai-local-ai-directly-in-aseprite)** | Local SD/FLUX in Aseprite; frame cutter for sheets | Medium (local GPU) | **Best privacy** for drafting on a locked-down workstation with a GPU |
| **Aseprite + SDDj** (local AnimateDiff) | Offline animation assist | Medium; Windows/NVIDIA-leaning | Good for air-gapped art PCs; polish still manual |
| **Hand pixel in Aseprite/Photoshop** | Final hero pets / accessories | Low automate / high quality | Gold standard for the 2–3 faces users stare at |
| Generic image models (ChatGPT/Midjourney/etc.) | Concept only | Low for true pixel grids | Always re-pixel / quantize in Aseprite; watch IP |

### 8.2 Recommended artist pipeline

1. **Lock style bible:** 32×32 walker + 64×64 pet, limited palette (≤32 colors), right-facing, transparent BG.
2. **Draft** in PixelLab Characters or Scenario Retro Diffusion Animation at exact cell sizes.
3. **Import sheet → Aseprite**; onion-skin; fix feet grounding / eye line; unify palette.
4. **Export** PNG strip or grid; drop into `src/assets/easter/pixel/…`.
5. **Optional:** keep SVG parametric builder for fallback characters until PNG packs ship.

### 8.3 Licensing checklist (before shipping art)

- [ ] Confirm plan tier allows commercial/internal use (Scenario free ≠ ship).
- [ ] No trademarked characters (no Nintendo cats, etc.).
- [ ] No API keys in git; generation scripts stay local / ignored.
- [ ] Prefer human polish on Tamagotchi hero frames (users stare at these).

---

## 9. Artist quick card (print this)

```text
WALKERS (main UI)
  Author:  32 × 32 px per frame
  Display: 32 × 32 CSS px @ 1×, image-rendering: pixelated
  Facing:  RIGHT (engine flips)
  Need:    walk×4, idle×2, sleep×2, jump×2 (annoyed/wave nice-to-have)

TAMAGOTCHI (sidebar bottom-left)
  Author:  64 × 64 px character (+ optional 64×64 accessory layers)
  Display: 128 × 128 CSS px @ 2×
  Stage:   ~232 × 120–160 CSS px biome area above sidebar footer
  Code slot: Sidebar.tsx between </nav> and offline/version footer

DO NOT author at 30×30. Integer scales only.
```

---

## 10. Open questions

1. **Master audience:** only the primary Admin Suite user, or visible on shared kiosk PCs? (Affects default-off + policy lock.)
2. **Shared-folder cosmetics:** sync XP across users of the same file, or per-browser local overlay?
3. **Sound:** soft UI ticks OK, or silent-only for ward PCs?
4. **Tabby as default:** replace parametric orange cat, or add as 4th character?
5. **Map home:** Dashboard card vs modal vs Settings showcase?
6. **AI talk:** ever allowed on hospital network, or forever keyword/FAQ only?
7. **Manager packaging:** ship Fun enabled in dist, or compile-time flag for “serious” builds?

---

## 11. Suggested MVP slice (next implementation PR)

Smallest delightful increment after art exists:

1. Fix walker **32×32** display alignment.
2. Add `TamagotchiDock` in Sidebar slot with scaled pet + biome placeholder + FAQ keyword search (reuse `filterFaq`).
3. Settings: “Sidebar companion” toggle under Fun / Easter eggs (default off).
4. One committed PNG pack (tabby walk + idle + sleep) behind a feature flag.
5. No XP/map/bosses yet — prove the dock + art pipeline.

---

## 12. References (in-repo)

- `docs/EASTER-COMPANION.md` — current walker behaviour A–Z
- `src/components/easter/Companion.tsx` — `SPRITE_SIZE`, overlay, measure
- `src/assets/easter/companionFrames.ts` — 32×32 frame builder
- `src/components/Sidebar.tsx` — Tamagotchi insert point
- `src/modules/SettingsModule.tsx` — Fun / Easter eggs card
- `src/lib/helpContent.ts` — `filterFaq` for companion search
