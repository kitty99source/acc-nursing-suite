# AI features — one-time local setup

**Status:** built, unit-tested with mocked HTTP responses. **Not yet verified against a real
running model** (see "What's actually been verified" at the bottom) — this doc is written for
the owner to run the real one-time setup on their own work laptop.

## What this is

AdminSuite can optionally use a small AI model that runs **entirely on your own laptop** (no
internet connection needed once installed, no data ever leaves the machine) to catch things a
purely rule-based check misses, and to answer questions about your own data and this app's own
rules. Two features are built on this so far, both gated by the same **Settings → "Enable AI
features"** toggle:

1. **AI-assisted duplicate-patient check** — Patients already has an exact-match check (same NHI,
   or the exact same name + date of birth); the AI pass additionally catches near-misses like a
   typo'd surname, a nickname, or a transposed date-of-birth digit, which the exact-match rule is
   guaranteed to miss by design (see `src/lib/patients.ts` vs `src/lib/patientDuplicateAi.ts`).
   It **never merges anything automatically** — only ever produces a dismissible suggestion banner
   in Patients, same "human reviews, then explicitly accepts" pattern the rest of this codebase
   already uses for staging/Review-Queue items.
2. **Global AI chat assistant** — a persistent chat panel docked bottom-right (collapsed to a small
   bubble by default), usable from any screen. Drag a patient row in (or click its chat icon) to
   attach it as a "context chip" and ask about that specific case; every reply has a "Context used"
   expandable section showing exactly what data was sent. The conversation is saved on this laptop
   only (its own local IndexedDB entry, never part of `.accdata`/Excel/full-backup exports) so it
   survives closing and reopening the app — use the trash icon in the chat panel's header at any
   time to permanently wipe it. See `docs/research/ai-chat-assistant-2026-08.md` for the full design
   writeup, what's in scope this pass (Patients only — no Contracts model exists in this repo), the
   telemetry/data-leak verification behind the persistence decision, and documented future work
   (contract-PDF-text RAG was explicitly NOT attempted).

## Why Ollama, and why no PowerShell proxy was needed

`ACC-RemittanceTracker`'s `scripts/launcher/ocr-http.ps1` established this team's pattern for
"a PowerShell launcher spins up a dedicated local HTTP port for a heavy asset/service" (there:
Tesseract OCR + PDF worker assets on port 8906, kept separate from the main SPA port so a slow
OCR request can never block the accept loop that serves normal page/chunk requests — see that
file's own history comments for the hard lessons behind that design).

For AI, the exact same architectural need already has an existing, off-the-shelf answer:
**Ollama itself is that dedicated local HTTP service** — once installed, it runs its own
always-on HTTP server at `http://127.0.0.1:11434`, completely independent of AdminSuite's own
launcher/port. AdminSuite's browser code (`src/lib/aiService.ts`) talks to it directly with
`fetch()`, the same way it would talk to any other local API. No new PowerShell code was needed
to reinvent that pattern — Ollama's Windows install already ships the "dedicated local HTTP
port for a heavy service" this team's OCR work established as the right shape, we're just
pointing at a pre-built one instead of compiling our own.

One thing that had to be checked, and turned out to already work: Ollama's default CORS
configuration (`OLLAMA_ORIGINS`) already includes `http://127.0.0.1:*`, which is exactly the kind
of address AdminSuite's own local launcher serves the app from — so the browser's `fetch()` calls
to `:11434` are not blocked by CORS out of the box. If a future Ollama version changes that
default, the fix is a `setx OLLAMA_ORIGINS "http://127.0.0.1:*"` (no reinstall) — flagged here so
a future "AI features says unavailable but Ollama is clearly running" report is fast to diagnose.

## One-time setup (owner does this once, on the work laptop)

**No administrator/IT rights are required for any of these steps** — this was the explicit
constraint driving the whole design (per the same admin-rights issue that affected Citrix Secure
Access on this laptop before). Confirmed via Ollama's own docs (`docs.ollama.com/windows`):
*"The Ollama install does not require Administrator, and installs in your home directory by
default."* — it installs under `%LOCALAPPDATA%`, never `C:\Program Files`.

1. **Download Ollama for Windows** from <https://ollama.com/download/windows> (about 700 MB).
2. **Double-click `OllamaSetup.exe`** and click through the installer (about a minute). It adds
   itself to your own user PATH and quietly starts itself in the background from then on,
   including automatically after every restart — nothing to manually launch each day.
3. **Open a Command Prompt** (Start menu → type `cmd`) and run:
   ```
   ollama pull phi4-mini-reasoning
   ```
   This downloads the actual AI model (~2.5 GB, one-time). Combined with the Ollama program
   itself, total disk use is roughly 3–4 GB.
4. In AdminSuite, go to **Settings → AI features (local, on-device)**, turn on **"Enable AI
   features"**, and click **"Check status"** to confirm it can see the model.

**Is it a one-time install? Yes.** After step 3, nothing needs to be repeated — Ollama runs
itself in the background from every Windows login, and AdminSuite auto-detects it every time the
app is opened. The only reason to touch this again later is to *update* the model (re-run
`ollama pull phi4-mini-reasoning` to get a newer version if one is released) — never required for
normal day-to-day use.

**Do you need to install "the model" separately from "the app"? Yes, and that's intentional.**
Ollama (the program) and the model (the actual ~2.5 GB neural network weights) are two separate
downloads, exactly like installing a PDF reader and then opening a specific PDF — the reader
only needs installing once, and can then open any number of files. Here it's the same idea:
Ollama only needs installing once, and can run any model you `pull`, including a different/newer
one later without reinstalling Ollama itself.

### Why not a single "click here to install everything" button?

A fully automatic in-app download+install was considered (per the original ask) but a browser
tab — which is all AdminSuite is, even served locally — cannot download and silently *execute* an
arbitrary `.exe` installer; every modern browser blocks that outright regardless of admin rights,
for the same reason it blocks any website from installing software on your machine without you
clicking through it yourself. The 4-step manual flow above is the genuinely lowest-friction
option that's actually possible from inside a browser-sandboxed app, and it only has to be done
once.

## What's actually been verified vs. not

- **Verified:** Ollama's Windows installer does not require admin rights (per Ollama's own
  current docs, checked 2026-08-04) and installs to `%LOCALAPPDATA%`.
- **Verified:** the integration code (`src/lib/aiService.ts`, `src/lib/patientDuplicateAi.ts`) is
  fully unit-tested with mocked HTTP responses (29 tests) — the HTTP client, timeout/graceful-
  failure behaviour, JSON-from-messy-model-text parsing, the fuzzy candidate-pair pre-filter, and
  the end-to-end "ask the model → parse → suggest" pipeline are all covered without needing a
  real model running.
- **Attempted but not achieved:** running an actual Ollama server + pulling
  `phi4-mini-reasoning` in this sandboxed dev environment, to test the real end-to-end flow
  against the synthetic patients in `sampleData.ts`. The Ollama macOS binary downloaded and
  logged "Listening on 127.0.0.1:11434" but the process was killed by this sandbox immediately
  after (no error logged — consistent with a sandbox network/process restriction, not a code
  bug). **This means the real model has NOT been run live yet, on any machine, for this
  feature.** The owner (or whoever has the real target Windows laptop) needs to do the one-time
  setup above and then try **Patients → "AI duplicate check (beta)"** for the first live,
  real-model test — ideally against the 7 sample patients already in `sampleData.ts` plus a
  couple of hand-added near-duplicate pairs, per the test plan in
  `docs/research/on-device-reasoning-and-call-capture-2026-08.md` Section 8.
