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
   This downloads the default AI model (~2.5 GB, one-time). Optionally also pull
   `phi4-mini` later if you want the secondary instruct tag (no forced chain-of-thought).
4. In AdminSuite, go to **Settings → AI features (local, on-device)**, turn on **"Enable AI
   features"**, click **"Check status"**, then use **Push this laptop harder** (CPU threads /
   keep model loaded) while watching Task Manager — see below.

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

## Groundedness on unknown topics (2026-08-04 — hard app-side gate)

The chat assistant is scoped to **New Zealand ACC + this app's knowledge base**. Prompt-only
"refuse when no excerpts" instructions were tried twice (`ba6a96a`, `ad054e9`) and **failed in
production** against `phi4-mini-reasoning` on CPU: with zero RAG hits the model still saw the full
static Schedule 5.x / NS04 rulebook (always injected into the system prompt) and inventing
"Emergency Transport Criteria" from nursing package caps, plus Geneva Conventions / foreign
air-ambulance encyclopaedia content in `<think>`. Soft instructions are not reliable on this model.

**Durable fix — hard pre-flight grounding gate** (`src/lib/ai/groundingGate.ts`):

1. Before any Ollama call (including long-chat summarization), the app runs RAG retrieval **and**
   scores the question against the static compliance rules / case stages (same TF-IDF-lite scorer
   family as chunk retrieval; static threshold `MIN_STATIC_RELEVANT_SCORE = 0.25`).
2. If **no retrieved chunks** AND **static KB is not relevant** AND no record chips are attached
   AND the message is not a simple greeting/thanks → **the model is never called**. The panel
   immediately shows a short deterministic assistant message (no Sources chips), e.g. that the
   current knowledge base has no grounded ACC material on that topic.
3. When the model *is* called, only static rules that scored as relevant are injected — not the
   whole rulebook every turn. Retrieved document excerpts are preferred when present.
4. Prompt scope-lock / groundedness text remains for in-scope turns (never invent named criteria
   documents, Geneva Conventions, aircraft models, etc. unless literally in excerpts).

So if you ask about a topic genuinely absent from the ingested corpus (e.g. Geneva conventions) and get a
short "I don't have grounded ACC material…" reply with no reasoning toggle and no Sources, that is
**working as designed** — the app refused before the model could hallucinate. In-scope questions
(e.g. NS04 prior approval, 25-consult package caps, telehealth / review-rights, **emergency
transport / patient travel** — see `docs/research/acc-public-contract-sources-2026-08.md` §10)
still reach the model normally. Chat sampling uses temperature `0.3`; `num_predict` stays at
2048. **New chat** clears messages, chips, and the rolling conversation summary together.

## Long-chat summarization (2026-08-04)

On a long conversation, raw history alone can still overflow the model's context window (or hang
Ollama) even with the 15-minute ceiling and oldest-turn trim. The chat panel now uses
**Cursor-style rolling summarization** before each send when needed:

1. **When:** prior history reaches 8+ messages, or the older-than-recent portion alone exceeds
   ~1200 estimated tokens. Checked *before* the main reply starts, so an oversized prompt is not
   sent first.
2. **How:** the same local Ollama model writes a short structured summary of older turns (facts,
   decisions, open questions, attached chip topics). The last 4 messages (2 exchanges) stay
   verbatim. Summarization is capped (~600 tokens, 3-minute timeout) and uses `AbortController`
   so Clear chat / Stop / New chat cancel it — never nested under a streaming answer.
3. **Where:** the rolling summary is saved with the chat in IndexedDB (same local key as the
   transcript). Reload reuses it instead of re-summarizing from scratch. Your visible message
   list is **not** rewritten — only the prompt sent to the model is compressed. The panel shows
   an “Earlier messages summarized” note when a summary is active.
4. **If summarization fails:** falls back to the existing aggressive oldest-turn trim and shows
   an honest note — never hangs forever guessing from deleted context.

See `src/lib/ai/conversationSummary.ts` and `src/lib/aiChatContext.ts` (`buildChatMessages`).

## Push this laptop harder (2026-08-04 — primary speed path)

Owner ask: make Ollama use more of the machine (cores / RAM / priority), not primarily switch
models. Honest answer: **partial** — we can push CPU threads and keep the model resident; “use
more memory” alone does not speed token decode once the model is warm and cores are busy.

**In Settings → AI features → “Push this laptop harder”:**

1. **CPU threads** — Auto (Ollama default ≈ physical cores), ~Physical, All logical, or custom.
   Sent as `options.num_thread` on each request (no admin). Measure after each change.
2. **Keep model loaded in RAM** — `keep_alive: -1` so ~3GB stays resident (avoids cold-reload).
3. **Check Task Manager while a reply streams** — Performance → CPU, and Details → `ollama.exe`.
   Low % → try more threads / power plan. Near 100% → already compute-bound; remaining slowness is
   tok/s × tokens (reasoning `<think>` can dominate).

**Windows (manual):** Best/High performance power mode; optional Above-normal priority for
`ollama.exe`; AV exclusions only if IT policy allows.

**Secondary (Settings details):** optional `phi4-mini` instruct tag if cores are already pegged
and CoT is the remaining cost. Full research: `docs/research/local-ai-speed-2026-08.md`.

## Speed optimization research (2026-08-04)

Beyond `keep_alive`, right-sized `num_ctx`, `num_predict`, and (now) optional `num_thread` /
pin-in-RAM — see `src/lib/aiService.ts` and the research note.

| Lever | Verdict | Why |
| --- | --- | --- |
| Explicit `num_thread` (API) | **Shipped (opt-in)** | Push more cores when Task Manager shows under-use. Overshooting to all hyperthreads can thrash. `OLLAMA_NUM_THREAD` env is **not** reliable. |
| Keep model loaded (`keep_alive: -1`) | **Shipped (opt-in)** | Uses more RAM continuously; removes reload stalls, not decode tok/s. |
| Flash Attention / `OLLAMA_KV_CACHE_TYPE` | **Not applicable** | GPU / FA-gated — silent no-op on CPU-only ([Ollama FAQ](https://docs.ollama.com/faq)). |
| `OLLAMA_NUM_PARALLEL` | **Not applied** | Multi-request server knob; can hurt single-user latency. |
| Larger `num_ctx` “to use more RAM” | **Anti-pattern** | Bigger KV → usually *slower*; we already cap at 8192. |
| Speculative decoding | **Not claimed** | No clean CPU Windows Ollama path for Phi-4-mini. |
| Instruct model / smaller tags | **Secondary** | Optional after compute is maximized. |
| Windows power plan / priority / AV | **Documented** | Owner-actionable; see Settings copy + research note. |

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
