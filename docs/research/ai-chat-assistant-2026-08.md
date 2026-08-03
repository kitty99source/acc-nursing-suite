# Global AI chat assistant — design notes + future work (2026-08)

**Date:** 2026-08-04
**Status:** Built and shipped this pass (see commit that introduces `src/components/AiChatPanel.tsx`).
Unit-tested with mocked HTTP (no real model needed to pass CI); **not yet verified against a real
running Ollama model**, for the same sandbox reason documented in `docs/ai-features-setup.md`.

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

## Chip types — Patients yes, Contracts confirmed NOT present

Per the owner's ask, this pass checked whether AdminSuite has a Contracts/provider-contract data
model to extend the same chip pattern to. **It does not** — a repo-wide search for
"contract"/"Contract" across `src/` turns up only compliance-rule text, service-code pricing labels,
and help copy; there is no `Contract` type in `src/types/index.ts`, no `ContractRecord` in
`AppData`, and no Contracts module in `src/modules/`. (`ACC-RemittanceTracker`, a sibling suite, does
have a real Contracts feature — but that is a different codebase and out of scope here.) So this
pass ships exactly one chip type (`patient`), and `ContextChipType` is written as a union so a
future `'contract'` (or `'claim'`, `'approval'`, etc.) variant can be added later without changing
the drag/drop or serialization plumbing.

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

- **Conversation persistence**: kept fully client-side/ephemeral (see `aiChatStore.ts` above) rather
  than added to the autosaved `.accdata` blob. This was a judgement call, not something the owner
  specified either way — flagging it here in case the owner would prefer conversations to survive a
  page reload (would need either an IndexedDB-backed store for just this data, or folding it into
  the main `AppData`/backup shape, which has PHI-export implications worth a deliberate decision
  rather than a default).
- **Which other record types get a chip button first** (Claims? Approvals? Declines?) beyond
  Patients — the owner's own examples included "provider contract, compliance item" but AdminSuite
  has no Contract model (see above) and Compliance findings are derived/computed, not a stored
  record type with a natural single "record" to chip. Left as-is (Patients only) rather than
  guessing which of Claims/Approvals/Declines the owner would want next.
