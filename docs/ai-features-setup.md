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
   bubble by default), usable from any screen. Drag a patient or contract row in (or click its chat
   icon) to attach it as a "context chip" and ask about that specific record; every reply has a
   "Context used" expandable section showing exactly what data was sent. While the model is still
   reasoning, its chain-of-thought streams live in a small collapsible section (Cursor-IDE style),
   collapsing to a "Show reasoning" toggle once the real answer starts. The conversation is saved on
   this laptop only (its own local IndexedDB entry, never part of `.accdata`/Excel/full-backup
   exports) so it survives closing and reopening the app — use the trash icon in the chat panel's
   header at any time to permanently wipe it. See `docs/research/ai-chat-assistant-2026-08.md` for
   the full design writeup, what's in scope (Patients and, as of 2026-08-04, Contracts — see
   `src/modules/Contracts.tsx`), the telemetry/data-leak verification behind the persistence
   decision, and documented future work (full contract-PDF-text RAG still NOT attempted — no real
   contract document corpus exists yet to build/test it against).

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
configuration (`OLLAMA_ORIGINS`) already includes `http://127.0.0.1:*` and `http://localhost:*`
(confirmed straight from Ollama's own `envconfig/config.go` source, not just docs prose), which is
exactly the kind of address AdminSuite's own local launcher serves the app from — so the browser's
`fetch()` calls to `:11434` are not blocked by CORS out of the box. If a future Ollama version
changes that default, the fix is `setx OLLAMA_ORIGINS "http://127.0.0.1:*,http://localhost:*"`
(no reinstall), then quit Ollama from the system tray and reopen it.

**If "Check status" ever reports unreachable despite Ollama visibly running (e.g. the root
`http://127.0.0.1:11434/` page in a browser tab says "Ollama is running"):** that root-page check
and AdminSuite's real check are NOT the same thing. Typing a URL into the address bar is a plain
page navigation, which browsers never subject to CORS — it only proves the TCP port is open, not
that AdminSuite's own cross-origin `fetch()` calls to it succeed. To tell a real CORS block apart
from Ollama actually not listening, open a new tab and go directly to
`http://127.0.0.1:11434/api/tags` (the actual endpoint AdminSuite calls) — if that shows JSON, the
port is fine and it's a CORS/proxy block from within AdminSuite's own tab (try the `OLLAMA_ORIGINS`
fix above, or check for a corporate proxy/antivirus intercepting local browser traffic); if that
tab also fails, Ollama isn't actually listening there. AdminSuite's own status-check message
(Settings → AI features → Check status) now spells out this exact same diagnostic step and gives
the precise `OLLAMA_ORIGINS` command when it hits this ambiguous "Failed to fetch" browser error,
so this should be self-diagnosable from the app alone going forward.

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

## Timeout tuning history (chat replies specifically)

The chat panel's streaming timeout has two independent numbers, tuned across three real
owner incidents on the same day (2026-08-04) — see `src/lib/aiService.ts`
(`DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS`, `DEFAULT_CHAT_TOTAL_TIMEOUT_MS`) for the full code
comments:

1. **Inactivity timeout — 2 minutes, resets on every streamed chunk.** This is the mechanism
   that actually detects a genuinely stuck/crashed reply (Ollama died mid-response, connection
   dropped) — a real freeze produces zero chunks for a full 2 minutes, which no known-legitimate
   slow-but-alive case has ever hit. Unchanged since it was introduced.
2. **Hard ceiling — 15 minutes total, regardless of progress.** Originally 5 minutes; raised
   after a 3rd real timeout report where the reply was visibly, actively streaming a real
   answer (not stuck) and the app's own liveness self-test confirmed Ollama was responding
   throughout — the 5-minute ceiling was simply too tight for a genuinely long, bounded
   (2048-token-capped) CPU-only reasoning reply, especially with the model's own hidden
   chain-of-thought counted against that same token budget. 15 minutes gives real headroom for
   a legitimately slow-but-healthy worst case while still catching a truly pathological
   "technically still emitting chunks, but absurdly slow" runaway case that the inactivity timer
   alone would never trip.
3. **UI messaging** now switches from the initial "30-90 seconds" framing to "Still generating —
   a detailed response like this can take several minutes on this hardware" once a reply has run
   past 2 minutes, so a genuinely long (but healthy) reply doesn't look broken/stuck to the owner
   while it's still working within the new, looser ceiling (`src/components/AiChatPanel.tsx`).

**If a reply times out anyway:** the panel's own "Quick check" note (a live `GET /api/tags` ping,
independent of the chat request) tells you whether Ollama itself is unreachable (points to a
genuinely stuck/hung process — fully quit and restart it) or still responding (this one reply
specifically stalled or is still running past even the 15-minute ceiling — try again, and
consider whether the question/attached context is unusually large).

## Speed optimization research (2026-08-04)

Beyond the settings already applied earlier this session (`keep_alive`, right-sized `num_ctx`,
Q4_K_M quantization, `num_predict` cap — see the code comments in `src/lib/aiService.ts` above
`DEFAULT_KEEP_ALIVE`), six further Ollama/local-inference speed levers were researched. Two are
genuinely inapplicable to this deployment, two carry a real tradeoff not worth taking here, and
two are Windows OS-level tips (not app code) worth doing manually:

| Lever | Verdict | Why |
| --- | --- | --- |
| Flash Attention (`OLLAMA_FLASH_ATTENTION=1`) | **Not applicable** | GPU-only optimization in Ollama's own code (gated on `GpuInfoList.FlashAttentionSupported()` — NVIDIA Ampere+/AMD RDNA3+ only). No CPU code path exists at all; setting this on a CPU-only laptop is a silent no-op. |
| KV cache quantization (`OLLAMA_KV_CACHE_TYPE=q8_0`) | **Not applicable** | Real and worthwhile in general (roughly halves KV-cache memory, negligible quality loss per published benchmarks), but Ollama requires Flash Attention to be active for it to take effect — unavailable on this CPU-only hardware for the same reason as above, so it would silently fall back to `f16` and do nothing. |
| `OLLAMA_NUM_PARALLEL` / `num_batch` | **Not applied** | Tunes concurrent multi-request throughput — a lever for a shared multi-user server. This app issues one request at a time from one local chat panel; there is nothing to parallelize, and raising it on an already CPU-core-constrained laptop risks worse latency for the one real request, not better. |
| Smaller model quant (Q4_0 instead of Q4_K_M) | **Not applied** | Checked current (2026) GGUF listings for this exact model: Q4_0 is documented upstream as "legacy... very high quality loss - prefer using Q4_K_M" for Phi-4-mini-reasoning specifically — barely smaller (2.33GB vs 2.49GB) with a real quality cost and no documented CPU speed win. Not worth the tradeoff. |
| Fewer/smaller retrieved knowledge chunks (top-2 vs top-3, smaller char cap) | **Not applied** | See the code comment above `retrieveKnowledgeForQuery` in `src/lib/ai/knowledgeCorpus.ts` — on a typical turn the prompt is already comfortably under the context budget, so the real bottleneck for a slow reply is decode (generation) throughput, not prefill (prompt processing); trimming one small chunk off an already-small prompt saves a negligible fraction of a second while permanently losing a third of the retrieved evidence on every question. Not a good trade for the actual problem. |
| Windows-specific OS tips (below) | **Documented, owner-actionable, no code change** | See below. |

### Windows-specific tips (owner-actionable, not code changes)

These are standard Windows performance practices that can help any CPU-bound background process,
including Ollama — none of them are AdminSuite code changes, and none are required, but they may
help if replies still feel slower than expected on battery or under load:

- **Power plan:** on a laptop, Windows' default "Balanced" power plan (and especially "Battery
  saver") throttles CPU clock speed to save power — this directly slows down CPU-only model
  inference. While actively using the AI chat (especially plugged into mains power), switching to
  Windows' "Best performance"/"High performance" power plan (Settings → System → Power & battery →
  Power mode) can measurably help.
- **Process priority:** Ollama runs as a normal-priority background process by default. Raising
  `ollama.exe`'s priority via Task Manager (right-click the process → "Go to details" → right-click
  `ollama.exe` → Set priority → "Above normal") can help it get more consistent CPU time on a
  laptop running other apps at the same time — this only lasts until the process restarts, so it
  is a manual per-session tweak, not a permanent setting.
- **Antivirus real-time scanning:** some antivirus products re-scan large files on every read,
  including a ~2.5GB model weights file every time Ollama loads it (cold-load) or memory-maps it.
  If your IT-approved antivirus supports folder exclusions, and IT policy allows it, excluding
  `%LOCALAPPDATA%\Ollama` and `~\.ollama\models` from real-time scanning can reduce cold-load
  stalls. **Only do this if your organisation's security policy explicitly allows antivirus
  exclusions** — this is a suggestion to investigate with IT, not an instruction to bypass
  security controls.

## What's actually been verified vs. not

- **Fixed (2026-08-04):** the first real-laptop test hit "Check status" reporting unavailable
  even after `ollama pull phi4-mini-reasoning` completed. Root-caused: `checkAiServiceStatus`
  never actually checked for the specific model at all — it only confirmed *some* Ollama server
  was reachable, and on any failure collapsed connection-refused, CORS-block, and timeout into one
  generic "not detected" message with no way to tell which had happened. Fixed: the check now (a)
  compares installed models against the required name ignoring the `:tag` suffix (`ollama pull
  phi4-mini-reasoning` always registers as `phi4-mini-reasoning:latest` in `/api/tags` — a strict
  string match would never have matched that), so it correctly reports "detected" once a model
  with any tag is pulled, and (b) surfaces three distinct, specific messages instead of one:
  server unreachable (with the CORS-vs-really-down diagnostic above), server up but model not
  pulled yet (with the exact `ollama pull` command to run), or ready. See `src/lib/aiService.ts`
  (`checkAiServiceStatus`, `modelListIncludes`, `describeStatusError`) and its tests.
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
