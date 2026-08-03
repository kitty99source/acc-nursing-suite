# Global AI chat assistant — design notes + future work (2026-08)

**Date:** 2026-08-04
**Status:** Built and shipped this pass (see commit that introduces `src/components/AiChatPanel.tsx`).
Unit-tested with mocked HTTP (no real model needed to pass CI); **not yet verified against a real
running Ollama model**, for the same sandbox reason documented in `docs/ai-features-setup.md`.

**2026-08-04 follow-up pass (this document's newer sections below):** owner asked (1) whether
chat history should persist across reloads (conditional on a telemetry/data-leak check) and (2)
for research on whether a small local model like this "learns" over time and, if not, what the
actual current best practice is. Both answered below — telemetry/leak check came back clean, so
persistence was implemented; the model-learning research recommendation is "extend the existing
structured-rules injection, not RAG yet, not fine-tuning."

## What this is

A second AI feature on top of the same local Ollama + `phi4-mini-reasoning` integration the
patient-duplicate-detection feature (`src/lib/aiService.ts`) already established: a persistent,
global chat panel (docked bottom-right, collapsed to a small bubble by default) that lets the owner
"talk to the suite" — ask general questions, or drag/click a patient record in as context and ask
about that specific case.

## Architecture

- **Reuses `src/lib/aiService.ts` as-is** — the exact same `generateLocalAiResponse` HTTP client
  the duplicate-detection feature uses, same `http://127.0.0.1:11434` default, same
  never-throws/graceful-degradation contract, same `aiFeaturesEnabled` Settings gate. No second
  HTTP client was built.
- **`src/lib/aiChatContext.ts`** (pure, no network) — new for this feature:
  - `ContextChip` type + `makePatientChip` / `serializePatientContext` / `serializeChipContext` /
    `buildContextBlock`: turns one or more dragged/clicked record chips into a plain-text block
    (the same text is shown back to the user via "Context used" for transparency — nothing hidden).
  - `AI_ASSISTANT_SYSTEM_PROMPT` / `buildComplianceRuleSummary` / `buildCaseStageSummary` — the
    "knows the rulebook" grounding. This is built **programmatically from this codebase's own real
    `COMPLIANCE_RULES` (`src/lib/compliance.ts`) and `CASE_STAGE_LABEL` (`src/lib/caseWorkflow.ts`)**,
    not hand-written/invented policy text — if those rules change, the prompt updates itself.
  - `buildChatPrompt` — assembles system prompt + context block (if any) + a capped window of
    recent conversation turns + the new user message into the single prompt string sent to
    `generateLocalAiResponse`. Pure string assembly, fully unit-tested without a real model.
- **`src/state/aiChatStore.ts`** — a small, SEPARATE zustand store from the main `useStore`
  (`state/store.ts`). Deliberately ephemeral/in-memory only: chips, message history, and
  open/collapsed state are never written to the IndexedDB-backed autosave blob and never exported
  in a `.accdata` backup. Closing the tab clears the conversation, same as closing a normal chat
  sidebar. This is a SEPARATE store (not a slice of the main one) specifically so a component that
  isn't a descendant of the chat panel (e.g. a Patients row) can add a chip without needing to be
  wired through the main app's data-mutation actions.
- **`src/components/AiChatPanel.tsx`** — the UI. Renders `null` outright when
  `settings.aiFeaturesEnabled` is off (same gate as the duplicate check). Collapsed bubble (badge
  shows attached-chip count) → expanded card using this app's existing `.card`/`.btn`/`--accent`
  design tokens (`index.css`), not a bolted-on style. Drop target for HTML5 drag-and-drop chips
  (`CHIP_DND_MIME`) plus a "Add to AI chat context" icon button on each Patients row as an explicit
  click-based fallback (both call the identical `addChip` action, so there is only one code path
  for "a chip got added"). Each assistant reply has a collapsible "Context used" `<details>` showing
  the exact serialized text sent for that turn — trust/transparency given PHI is involved. A fixed
  "Runs 100% locally — no patient data leaves this laptop" note stays visible in the panel header at
  all times.

## Chip types — Patients yes, and (as of 2026-08-04) Contracts too

Per the owner's ask, this pass checked whether AdminSuite has a Contracts/provider-contract data
model to extend the same chip pattern to. **At the time of the original build, it did not** — a
repo-wide search for "contract"/"Contract" across `src/` turned up only compliance-rule text,
service-code pricing labels, and help copy; there was no `Contract` type in `src/types/index.ts`,
no `ContractRecord` in `AppData`, and no Contracts module in `src/modules/`. So the original pass
shipped exactly one chip type (`patient`), with `ContextChipType` written as a union so a future
`'contract'` variant could be added later without changing the drag/drop or serialization plumbing.

**2026-08-04 follow-up: this gap has now been filled.** See "Full knowledge: ACC contracts +
general 'know everything' capability" below for the full writeup — short version: a real,
first-class `Contract` type now exists (`src/types/index.ts`), with CRUD in
`src/modules/Contracts.tsx` (sidebar → **Contracts**) and a `'contract'` chip type
(`makeContractChip`/`serializeContractContext` in `lib/aiChatContext.ts`), wired into the chat
panel exactly like Patients (a click-to-attach chat icon on each row).

## Explicitly NOT attempted this pass (future work)

**Full contract-PDF-text ingestion + vector search (RAG) was not attempted.** The owner's own ask
scoped this down for the current pass ("do NOT attempt a full document-RAG pipeline... note it as a
documented future step"). If/when AdminSuite gains a real Contracts data model (structured fields
first, per the rescoping playbook's "map onto existing primitives" guidance), the natural next step
after that would be:

1. Structured Contract fields (name, employer, rate table, expiry, etc.) as a second `ContextChip`
   type — small, additive change to `aiChatContext.ts` (`serializeContractContext` alongside
   `serializePatientContext`) and the existing `ContextChipType` union.
2. Only THEN, as a separate and materially bigger project: actual PDF full-text ingestion +
   chunking + embedding + a local vector index (e.g. `sqlite-vec` or a simple in-browser cosine-
   similarity index over pre-computed embeddings, since there is no server to run a real vector DB
   against) so the model could search across contract PDF *text*, not just structured fields. This
   needs its own design pass: which embedding model runs acceptably on a CPU-only laptop, where the
   vector index lives (IndexedDB blob store, same pattern as other attached files), chunk size/
   overlap tuning, and a UI for "which contracts are indexed" — none of that exists yet and none of
   it was built or faked in this pass.

## Design choices explicitly left as open questions (not guessed)

- **Conversation persistence — RESOLVED 2026-08-04, now implemented.** Previously kept fully
  client-side/ephemeral; the owner has since asked for persistence conditional on a telemetry/leak
  check. See "Telemetry / data-leak verification" and "Persistence implementation" below for the
  full writeup — short version: verified clean, so messages/chips now persist to their own
  IndexedDB key (`lib/idb.ts` `loadAiChatHistory`/`saveAiChatHistory`/`clearAiChatHistory`),
  deliberately kept OUT of the `AppData`/`.accdata`/backup-ZIP/Excel-export shape (same treatment
  as the existing audit log / staging queue / import history keys), with an explicit one-click
  "Clear chat history" wipe in the panel.
- **Which other record types get a chip button first** (Claims? Approvals? Declines?) beyond
  Patients — the owner's own examples included "provider contract, compliance item" but AdminSuite
  has no Contract model (see above) and Compliance findings are derived/computed, not a stored
  record type with a natural single "record" to chip. Left as-is (Patients only) rather than
  guessing which of Claims/Approvals/Declines the owner would want next.

## Telemetry / data-leak verification (2026-08-04, before implementing persistence)

Per the owner's explicit condition ("as long as there's no telemetry or risk of data leakage") this
was verified BEFORE any persistence code was written, not assumed.

**1. Does Ollama itself send telemetry?** Checked Ollama's own docs/FAQ, GitHub issues, and three
independent 2026 third-party audits (not just Ollama's own claims) via live web search — not from
training-data memory, since this is exactly the kind of policy that changes over time:

- Ollama's own FAQ (`docs.ollama.com` / `ollama/ollama` GitHub `docs/faq.md`) states plainly it does
  not send prompts/responses/model-interaction content anywhere. Maintainers confirm the same
  directly on `ollama/ollama` issues [#11442](https://github.com/ollama/ollama/issues/11442) and
  [#2567](https://github.com/ollama/ollama/issues/2567): *"No telemetry, Ollama is fully local."*
- Independent source-code audits (D-Central's "Local-AI Telemetry & Air-Gap Audit", checked against
  `app/lifecycle/updater.go` directly, and a separate "Local AI Privacy Audit" piece, both dated
  2026) agree on the same one caveat: the **desktop tray GUI app** (Windows/macOS) makes an hourly
  update-check call to `ollama.com` (OS + Ollama version only, no prompt content) to notify about
  new releases. This is absent entirely when running the **headless server** (`ollama serve`, which
  is what a background Windows service/launcher would run) — confirmed in the D-Central audit as
  "server use: genuinely silent... no analytics SDK in repo."
- One unrelated detail worth flagging to the owner even though it doesn't affect this app: Ollama's
  OWN interactive CLI (`ollama run <model>`) keeps a **local, unencrypted, on-disk** REPL history
  file (`~/.ollama/history` / `%LOCALAPPDATA%\Ollama\history`) — nothing is transmitted, but it is
  plaintext on the machine. **This does not apply to AdminSuite's integration** — `aiService.ts`
  talks to Ollama's `/api/generate` HTTP endpoint directly (never `ollama run`), so that file is
  never touched by anything this app does. Mentioned here only so the owner has the full picture if
  they also use `ollama run` manually for anything else.
- **Verdict: clean.** No telemetry from the headless server this app talks to; the only outbound
  call anywhere in Ollama is the optional desktop-app update-checker, which does not carry prompt
  content and does not run in headless/server mode. Nothing to disable for this app's use case
  (there is no separate opt-out toggle needed because the code path that would phone home — the
  tray GUI — isn't the one AdminSuite depends on).

**2. Does AdminSuite's own integration code make any non-loopback network call?** This was a
code-level grep, not a docs-only check, across every `fetch(` call in `src/`:

- `src/lib/aiService.ts` (used by both the duplicate-detection feature and the chat panel): every
  call targets `${baseUrl}/api/...` where `baseUrl` is the Settings-configurable
  `aiServiceBaseUrl`, defaulting to `http://127.0.0.1:11434` (`lib/defaultSettings.ts`) — loopback
  only, by construction.
- Every other `fetch(` call anywhere in `src/` (`localAccBridge.ts`, `emailSyncStatus.ts`,
  `emailSyncRefresh.ts`, `launcherLifecycle.ts`) targets a **relative** URL path (e.g.
  `/_acc/staging`, `/_acc/heartbeat`, `/_acc/email-sync`) — these resolve against
  `window.location.origin`, i.e. whatever host/port the local launcher (`launch.ps1`) is already
  serving the app from (also loopback, per that launcher's own TcpListener binding). None of these
  are AI-related; they're the existing local-launcher-bridge endpoints for staging/inbox/email-sync,
  unrelated to this feature, checked here only for completeness of "does anything in this repo call
  out."
- No analytics SDK, error-reporting service, or third-party tracking script exists anywhere in
  `package.json`'s dependencies or `src/` (grepped for `analytics|telemetry|sentry|posthog|
  mixpanel|amplitude`, case-insensitive — the only `analytics` hits are this app's own
  `lib/analytics.ts`, a pure local billing-metrics module with a name collision, not a tracking
  library).
- **Verdict: clean.** Zero network calls anywhere in the AdminSuite codebase target anything other
  than `127.0.0.1`/loopback or a same-origin relative path.

**Conclusion: no telemetry, no data-leak risk found in either Ollama itself (headless/server mode,
confirmed 2026) or this app's integration code (confirmed by direct grep, not just design intent).
This clears the owner's explicit precondition for implementing persistence — proceeded to Part C.**

## Persistence implementation (2026-08-04)

- **What's persisted:** the chat panel's message history and any attached context chips —
  `src/state/aiChatStore.ts`'s `messages`/`chips` state.
- **Where:** a dedicated new IndexedDB key (`aiChatHistory`, `src/lib/idb.ts`
  `loadAiChatHistory`/`saveAiChatHistory`/`clearAiChatHistory`) inside the SAME `acc-nursing-suite`
  IndexedDB database the rest of the app already uses for its offline-first local data — but as its
  own separate key, not folded into the `AppData`/working-copy blob.
- **Why a separate key, and what that means for exports:** this repo already has a clear, existing
  precedent for "local-only state that is NOT part of the exportable/backed-up data shape" — the
  audit log (`AUDIT_LOG_KEY`), the Excel-import rollback snapshot, the staging queue, and the
  import history are all their own IndexedDB keys, and `lib/backup.ts`'s full-backup ZIP only ever
  serializes `AppData` (patients/claims/settings/etc.) plus document blobs — none of those other
  local-only keys are in that ZIP either, even though some (e.g. the staging queue) can also
  reference patient-identifying data. Chat history follows that SAME existing pattern rather than
  inventing a new rule: it lives in IndexedDB (survives a reload, "not silently lost" per the
  owner's ask) but is automatically, structurally excluded from `.accdata` saves, the Excel export,
  and the full-backup ZIP — exactly like those other local-only keys, so there was no separate
  "explicitly exclude it from Export Center" change needed; it was never in that code path to begin
  with. This was double-checked directly against `src/modules/ExportCenter.tsx` and `lib/backup.ts`
  — neither references `aiChatHistory` or the chat store at all.
- **"Clear chat history":** a dedicated trash-icon button in the chat panel header (next to the
  existing "New chat" button), always visible, disabled only when there is nothing to clear.
  Requires a `window.confirm` before wiping (since this can contain PHI and there is no undo) and
  deletes both the in-memory state and the IndexedDB record. "New chat" now does the identical
  underlying wipe (there is only ever one persisted conversation thread, so "start a new chat" and
  "clear history" are the same operation once history is persisted) — kept as two separate,
  distinctly labelled buttons so the panel still offers a low-friction "start over" alongside an
  explicit, unambiguously-named PHI-wipe action.
- **Settings gate interaction (judgement call, documented):** turning OFF Settings → "Enable AI
  features" hides the chat panel's entry point (unchanged behaviour) but does **not** auto-clear
  persisted history. Reasoning: disabling the toggle is not itself a request to delete data — a
  user might toggle it off/on while troubleshooting Ollama, and auto-wiping a real conversation as
  a side effect of an unrelated Settings checkbox would be a surprising, hard-to-reverse action.
  Wiping is always the owner's explicit, separately-confirmed "Clear chat history" click, never an
  implicit consequence of a different setting.
- **PHI handling:** unchanged from the original design — the exact same "Context used" disclosure
  the un-persisted version already had is still shown on every assistant reply, so a persisted
  conversation is exactly as transparent about what data it contains as the ephemeral one was.

## Research: does a small local model "learn" over time, and what's the actual best practice? (2026-08)

**Direct answer to "is this going to build its own mental model, or is the model not intelligent
enough, or do we need reusable JSON rules?": no, it will not build its own mental model on its own,
and that has nothing to do with this particular model being under-powered — it's how ALL of these
models work, including much larger ones.** A model like `phi4-mini-reasoning` running via Ollama's
`/api/generate` is **stateless per request**. There is no background process updating its weights
from your conversations; every call in `aiService.ts` sends a fresh prompt string, gets back a
fresh response, and the model retains literally nothing afterward except what the calling code
(here, `buildChatPrompt`) explicitly re-sends as text in the next prompt. This is true of every
model served this way — GPT-5-class cloud models work identically underneath the chat-UI illusion
of "it remembers our conversation," which is really just the client re-sending the transcript each
time (exactly what `buildChatPrompt`'s `MAX_HISTORY_TURNS` window already does here). "Learning"
in the machine-learning sense (updating weights) only happens during an offline training run, never
during inference — there is no code path in Ollama, llama.cpp, or any mainstream local-inference
runtime that mutates a running model's weights from chat traffic. So: **honest answer is "no
automatic learning," and it is not a symptom of the model being too small or not smart enough —
it would be equally true of a 70B model.**

**So what's the actual 2026 practitioner consensus for approximating "gets better over time" without
training?** (Sources: search results this pass, not prior-knowledge recall, given how fast this
space moves — see citations inline.)

1. **RAG (retrieval-augmented generation).** What it actually is: at request time, the calling code
   searches a knowledge store (usually a vector database of embedded text chunks, sometimes
   combined with keyword search — "hybrid search" is now the 2026 norm per
   [whatgenerativeai.com's agent-memory playbook](https://www.whatgenerativeai.com/docs/genai-playbook/agents-memory-rag/))
   for passages relevant to the current question, and pastes the top few results into the prompt
   before sending it to the model — conceptually a fancier, automatic version of what
   `buildContextBlock` already does manually for a dragged-in patient chip. **When it's worth it:**
   once there is a large, growing, and/or frequently-changing unstructured corpus to search (e.g.
   hundreds of contract PDFs, or years of accumulated "how we handled case X" free text) — per
   [Hamza Shabbir's 2026 RAG/fine-tune/prompt decision tree](https://hamzashabbir.dev/article/rag-vs-fine-tune-vs-prompt-2026-decision-tree),
   the rule of thumb is: if your knowledge base is stable and fits comfortably in-context (their cited
   threshold is roughly 200K tokens, i.e. plausibly the size of this app's ENTIRE compliance
   rulebook + case-stage list many times over), full-context prompting — which is exactly what this
   app's system prompt already does — beats building a RAG pipeline; RAG earns its cost once facts
   "change often or live past the model's cutoff" or the corpus is too large to paste in every time.
   **Overkill for this app today:** AdminSuite currently has no large unstructured corpus at all
   (confirmed earlier in this doc — no Contracts model, no accumulated case-history text store); a
   vector database, embedding model, and chunking/retrieval pipeline would be solving a problem that
   doesn't exist yet.
2. **A structured, owner-editable "rules/knowledge base" file, selectively injected into the system
   prompt.** This IS a legitimate, actively-recommended lightweight alternative for exactly this
   shape of problem — [Winder.ai's 2026 RAG-vs-fine-tuning framework](https://winder.ai/rag-vs-fine-tuning-2026-decision-framework/)
   and the Hamza Shabbir piece above both describe "full-context prompting with a stable, curated
   knowledge document" as the correct FIRST choice (not a lesser fallback) for a small, mostly-static
   knowledge base — reaching for a vector database before you have one is the commonly-cited 2026
   mistake ("cheaper long context made the old always-RAG reflex wrong about a third of the time").
   **Is this basically what's already happening here?** Yes, largely — `AI_ASSISTANT_SYSTEM_PROMPT`
   is already built programmatically from `COMPLIANCE_RULES` and `CASE_STAGE_LABEL`, which is
   structurally identical to "a reusable rules file selectively injected into the system prompt," it
   just wasn't factored into its own dedicated module before this pass (see "Groundwork" below —
   that refactor is exactly this recommendation, made real).
3. **Few-shot examples** ("here's how a similar case was handled well before") added to the system/
   context. Cheap, no training, and a well-established technique for biasing a small model's output
   toward house style/reasoning without retraining anything — this is the natural next increment on
   top of #2 once there is a real bank of "good examples" worth curating (there isn't one yet in this
   app; a first handful would likely come from the owner reviewing actual past chat transcripts or
   case outcomes and hand-picking a few to codify).
4. **Fine-tuning / LoRA — feasibility check, not oversold.** Full fine-tuning of a model this size
   is not realistic on a CPU-only, <16GB-RAM laptop with no training infrastructure — full weight
   updates need the whole model plus gradients plus optimizer state resident at once, which is a
   fundamentally different (and far heavier) workload than inference. **Very small LoRA adapters are
   technically closer to feasible than that** — 2026 practitioner writeups (e.g.
   [a documented CPU-only LoRA run on a similarly-sized model](https://dev.to/tanay_kolekar/from-local-cpu-to-aws-fine-tuning-a-3b-llm-for-zero-cost-rd-14c),
   16GB RAM, ~2.5 hours for a 3B model's adapter; [LoFT](https://github.com/diptanshu1991/LoFT),
   an 8GB-MacBook LoRA-to-GGUF toolchain for 1–3B models) show it is not science fiction for a
   model in the Phi-4-mini-reasoning size class. **But this is a genuinely separate, much bigger
   project than anything else discussed here** — it needs a Python ML environment (`transformers`,
   `peft`, `trl`), a curated instruction-tuning dataset (which does not exist yet — the chat history
   this pass just started persisting could eventually seed one, once there's enough of it and the
   owner has reviewed/approved which examples are worth training on), an export/merge/quantize
   pipeline back into a GGUF Ollama can load, and — critically — every source consulted agrees LoRA
   is for **teaching style/format/tone**, never for teaching new fixed facts (that's what #2/#3
   above are for). **Verdict: not now, not as a near-term recommendation — worth a one-line mental
   note that it's not impossible on this hardware if a much larger, dedicated ML-training effort is
   ever justified, but nothing to build today.**

**Decisive recommendation for THIS app, at THIS model size, right now:**

- **(a) Extend the existing structured-rules injection — do this, and it's the small refactor this
  pass actually made** (see "Groundwork" below). This is the correct current-state answer to
  "do we need reusable JSON rules or something" — yes, in spirit, and it already existed in
  embryonic form; it just needed its own home so it's obviously extensible rather than baked
  directly into the prompt-assembly file.
- **(b) Do NOT build RAG yet.** There is no real unstructured corpus to search today. Revisit once
  one exists (see the concrete "when to build it" plan in the next section) — building it now would
  be solving a problem AdminSuite doesn't have.
- **(c) Do NOT attempt fine-tuning/LoRA.** Not because the model is too small to ever benefit, but
  because there is no training infrastructure, no curated dataset, and — per every source consulted
  — fine-tuning is the wrong tool for "knows our facts/rules" in the first place; that job belongs
  to (a) and eventually (b).
- **What to concretely build next, in order, once there's appetite:** (1) start curating a small
  hand-picked set of `FewShotExample`s in `lib/ai/knowledgeBase.ts` from real (owner-reviewed,
  PHI-scrubbed) past cases — the extension point for this already exists as of this pass and is
  currently intentionally empty; (2) once AdminSuite gains a real Contracts data model (per the
  existing "map onto existing primitives" note earlier in this doc), add structured contract fields
  as a `KnowledgeFact`-shaped input rather than jumping straight to PDF-text RAG; (3) only once
  there is a genuinely large, growing, hard-to-paste-in-full unstructured corpus (contract PDF full
  text, or a real multi-year case-history archive) does full RAG become worth its own setup cost —
  see the build plan immediately below.

## Future RAG build plan (not implemented — follow-up project outline)

**Trigger condition:** build this only once there is a real, sizeable, unstructured text corpus
that no longer fits comfortably in a single system-prompt paste — realistically, once AdminSuite has
either (a) a Contracts feature with attached contract PDFs whose full text the owner wants
searchable, or (b) enough accumulated real case-history free text that hand-curating few-shot
examples stops scaling. Per the research above, do not build this pre-emptively.

1. **Chunking.** Split each source document (contract PDF text, case notes, etc.) into overlapping
   text chunks (a common starting point is a few hundred tokens per chunk with modest overlap) —
   this needs its own tuning pass once real documents exist; synthetic test documents up front risk
   optimizing for the wrong chunk boundaries.
2. **Embeddings.** Pick a small embedding model that can run acceptably on the same CPU-only laptop
   (a separate, much smaller model than `phi4-mini-reasoning` — embedding models are typically
   orders of magnitude cheaper to run than generation). Ollama itself can serve dedicated embedding
   models (e.g. `nomic-embed-text`-class models) via the same local HTTP server this app already
   talks to, so no second runtime would be needed — worth confirming CPU throughput once real
   documents exist.
3. **Local vector index.** Since there is no server process to run a real vector database against
   (this is a single-file browser app), the realistic options are: (a) a simple in-browser
   brute-force cosine-similarity search over pre-computed embedding vectors stored as a new
   IndexedDB blob store (viable while the corpus stays in the low thousands of chunks — no exotic
   dependency, consistent with this app's existing "everything lives in IndexedDB" architecture), or
   (b) `sqlite-vec`/similar if/when a WASM-SQLite dependency is judged worth adding. Start with (a);
   only reach for (b) if search latency or corpus size make brute-force cosine search too slow.
   Store embeddings alongside the existing document-blob pattern (`DOC_STORE` in `lib/idb.ts`), not
   inside the main autosave blob, for the same "large binary data stays out of the hot-path JSON"
   reason that pattern already exists.
4. **Retrieval + injection.** At chat-send time, embed the user's question with the same embedding
   model, cosine-search the index for the top few chunks, and inject them into
   `lib/ai/knowledgeBase.ts`'s `buildKnowledgeBaseSections()` output (the exact extension point this
   pass built) as a new "Retrieved passages" section — alongside, not replacing, the existing
   compliance-rules/case-stage/few-shot sections. Always show retrieved passages in the existing
   "Context used" disclosure, exactly like a manually-attached patient chip, for the same
   PHI-transparency reason.
5. **A UI for "what's indexed."** Users need to see which contracts/documents have been embedded
   and re-index on demand (e.g. after a contract is updated) — this needs its own small settings/
   status surface, not built yet.
6. **Re-verify the telemetry/leak posture for whichever embedding model gets chosen** — the same
   `checkAiServiceStatus`/loopback-only verification done in this pass for `phi4-mini-reasoning`
   should be repeated for any new model pulled into Ollama, since a different model's own license/
   behaviour is a separate thing to confirm.

None of the above is built or faked in this pass — this is a design outline for when the trigger
condition above is actually met, per the same "don't build the full pipeline until the data volume
justifies it" instruction that already shaped the original chat-panel build (see "Explicitly NOT
attempted this pass" earlier in this doc).

## Groundwork refactor: `lib/ai/knowledgeBase.ts` (2026-08-04)

Per the research recommendation above ("extend the existing structured-rules injection, don't build
RAG yet"), the previously-inline `buildComplianceRuleSummary`/`buildCaseStageSummary`/prompt-assembly
logic (formerly living directly in `lib/aiChatContext.ts`) has been pulled out into a new
`src/lib/ai/knowledgeBase.ts` module. This is intentionally a SMALL, low-risk refactor — no new
knowledge sources were added, no behaviour changed (existing tests for the exact system-prompt
content pass unmodified) — the only change is that there is now one obvious file that owns "what
static knowledge gets injected into the assistant," with an explicit, documented, currently-empty
extension point (`fewShotExamples()` / the `FewShotExample` type) for the next real addition,
instead of that logic being scattered inline inside the prompt-assembly file. `lib/aiChatContext.ts`
re-exports the same function names it always had for backwards compatibility with existing callers/
tests, so this is additive/structural, not a breaking change.

## 2026-08-04 follow-up pass: speed, live reasoning streaming, and Contracts

Three separate owner asks landed together in one pass — recorded here as one coherent update.

### 1. Speed tuning (CPU-only, <16GB RAM, Ollama + Phi-4-mini-reasoning)

Two concrete, low-risk request-option changes applied directly to `src/lib/aiService.ts`
(`generateLocalAiResponse` and `generateLocalAiResponseStream` — i.e. both the duplicate-check
and chat-panel code paths):

- **`keep_alive: "30m"`** (new `DEFAULT_KEEP_ALIVE` constant, overridable per call). Ollama's own
  default unloads a model from RAM 5 minutes after the last request
  ([`docs/faq.md`](https://github.com/ollama/ollama/blob/main/docs/faq.md)), forcing a slow
  disk→RAM reload on the next message — exactly the "10-60s+ cold-load" cost this file's own
  existing chat-timeout comments already document. Since local-first only pays off with repeated
  local use, keeping the model warm for 30 minutes of idle time (not indefinitely — `-1` was
  considered and rejected as the default, to avoid pinning ~3.2GB of RAM for an entire unattended
  workday) is a real, meaningful win with no quality tradeoff.
- **`num_ctx: 4096`** (new `DEFAULT_NUM_CTX` constant, overridable per call). The owner's own
  `ollama list` output showed this model's max context as 131072 tokens, and Ollama silently
  allocates a KV-cache sized for whatever `num_ctx` a request specifies (or the model's own max, if
  unspecified) — a real, avoidable memory/CPU cost for what is typically a short chat message. This
  app's own prompt assembly (`buildChatPrompt`, `MAX_HISTORY_TURNS = 8`) never comes close to
  needing 128K tokens; 4096 is a generous-but-right-sized ceiling.
- **`num_thread`: deliberately NOT set.** Ollama's server already defaults this to the detected
  physical CPU core count, and current guidance is that manually pinning it on a single-user
  desktop workload rarely helps and can hurt (thread oversubscription if set too high). There is no
  way to know the real core count of "the owner's laptop" from this codebase, so nothing was
  guessed — documented here as a real, available, laptop-specific tuning knob if the owner ever
  wants to hand-set it.
- **Quantization (Q4_K_M): confirmed no further easy win.** Already a good balance per the
  original research table. A Q4_0/Q3 variant would trade real speed for a real, non-trivial
  quality drop specifically on the reasoning-heavy tasks this model was chosen for — documented as
  an available option, not recommended.
- **`num_predict` (2048, from the prior "rambling on hello" fix): left as-is**, per the explicit
  instruction not to reduce it blindly (risk of truncating a genuinely long answer). Already
  overridable via the existing `numPredict` option.

**Plain-language expected impact:** the single biggest real-world win is `keep_alive` — a session
where the owner sends several messages in a row (the normal chat use case) should feel
meaningfully snappier after the first message, since the model no longer has to be reloaded from
disk into RAM on every single turn once it would otherwise have gone idle. `num_ctx` mainly
reduces the fixed per-request memory/setup overhead rather than tokens/sec once generating — a
smaller, second-order but real speedup, more noticeable on a memory-constrained machine than a
well-resourced one. Neither change touches model quality (same weights, same quantization).

New tests: `src/lib/aiService.test.ts` covers the `keep_alive`/`num_ctx` defaults and their
overrides on both the streaming and non-streaming request paths.

### 2. Live-streaming reasoning trace (Cursor-IDE style)

`src/components/AiChatPanel.tsx`'s in-progress ("sending") render logic changed: while a `<think>`
block is still open (`parseThinkResponse(...).thinking === true`), the panel now renders the
**actual streaming reasoning tokens live**, in a small muted/italic auto-scrolling box (with a
"Reasoning…" header and blinking cursor), instead of the previous static "Reasoning through your
question…" placeholder that hid the real content. Once the `</think>` tag closes and the model
starts streaming its final answer, that live reasoning box **collapses down into the same
"Show reasoning" `<details>` toggle** a finished message already ends at (closed by default) — so
the UI is never left cluttered with a now-stale reasoning trace once the real answer is visible.
This is a pure UI change on top of the same already-built, already-tested `thinkParser.ts`
open/closed-tag state — no parser changes were needed. Updated/added coverage in
`src/components/AiChatPanel.test.tsx`.

### 3. Contract data model + chip type, and the general-knowledge/privacy tradeoff

**Investigated first, per instruction — no content invented:**

- Confirmed AdminSuite still has **no Contract data model and no real contract documents anywhere
  in this repo** (this doc's own earlier section already recorded that finding; re-confirmed).
- Checked the sibling `ACC-RemittanceTracker` repo's
  `src/lib/accreditedProvider/employerCatalog.ts`: it has a structured `AccreditedEmployer[]`
  catalog (name + AR customer number, some with a claims email/attn line) — **structured reference
  data, not full contract document text**. Its own file header comment says "Not PHI," but the
  team's own backlog notes (`.cursor/rules/remittance-current-backlog.mdc`) separately flag the
  real customer numbers in that file as an **open, unresolved "does this need scrubbing" question**
  from an earlier PHI audit. Given that question was never actually resolved, this pass made the
  conservative call: **that data was NOT imported/mirrored into AdminSuite.** The new Contract type
  was informed by `AccreditedEmployer`'s shape (name + customer number) but ships with **zero seed
  data** — Contracts starts empty in AdminSuite; the owner adds real ones. If the owner confirms
  those customer numbers are safe to duplicate (not real, sensitive business data), that seeding
  can be added later as a quick follow-up.

**Built, given no real contract corpus exists to RAG over:**

- A genuine, first-class **`Contract` type** (`src/types/index.ts`): provider/employer name,
  customer number, claims email, effective-from/to dates, service codes covered, and a rate table
  (service code + description + rate). Added as an optional/additive `AppData.contracts?: Contract[]`
  field (same pattern as `customSheets`/`importHistory`), so no existing fixture/migration needed
  updating.
- Full CRUD UI at **sidebar → Contracts** (`src/modules/Contracts.tsx`), following this codebase's
  existing record-module pattern (`ComplexCases.tsx` was the closest template) — list, add, edit,
  delete, plus an inline rate-table editor.
- A new **`'contract'` context-chip type** (`ContextChipType` extended from `'patient'` to
  `'patient' | 'contract'`, exactly the extension point left ready in the original build):
  `makeContractChip` / `serializeContractContext` in `lib/aiChatContext.ts`, and a
  "Add to AI chat context" chat-icon button on each Contracts row, identical UX to the existing
  Patients row button.
- New tests: `src/state/contracts.test.ts` (CRUD) and additions to `src/lib/aiChatContext.test.ts`
  (contract chip creation, serialization, graceful-degradation on a deleted/absent record).

**The general-knowledge / "search up anything" ask — explicitly flagged, not silently decided:**

A genuinely offline, on-device model **cannot** search the live internet or know about anything
outside its training data plus whatever text this app explicitly feeds it in the prompt — there is
no third option that preserves both "knows everything" and "100% local, nothing leaves this
laptop," and this app's own UI/docs already make the second promise explicitly and repeatedly
(the chat panel's fixed header note, this doc, `docs/ai-features-setup.md`). Two real paths exist,
and **neither was silently picked**:

1. **Add a real web-search/cloud-lookup tool call.** Technically straightforward, but a
   consequential product decision — it would mean this feature sometimes DOES send data (at least
   the search query, likely more) off this laptop, directly contradicting the privacy claims
   already shipped in the UI. **Not implemented. Needs the owner's explicit, informed sign-off**
   before any code along these lines is written.
2. **Curate more real static knowledge into the existing injection system** (`lib/ai/knowledgeBase.ts`)
   as real documents/data become available — this is the "RAG once you have real data" path the
   research doc already recommended, and the Contract model above is a concrete step along it
   (structured facts now; full document text search later, once there's something real to search).

**Concrete next step to actually get contract knowledge in, if the owner wants it:** tell us where
real ACC contract PDFs/documents live (a folder path, an email they arrived in, a shared drive —
whatever the actual source is), or hand over 2-3 real examples, and the next build phase is the
actual text-extraction + chunking + embedding + local-vector-search pipeline described in "Future
RAG build plan" above — genuinely blocked on having real source material to build and test against,
not a coding limitation.
