# Research: Call-Capture Companion App + On-Device Reasoning LLM Feasibility

**Date:** 2026-08-04
**Status:** Research only — no code changes. Nothing in this doc has been implemented.
**Scope:** Two connected ideas from the owner: (1) a phone app that records/transcribes calls and feeds structured notes into the admin suite, and (2) whether a small LLM can run locally on an ordinary work laptop to do the "breakdown into structured notes" reasoning step.

---

## 1. TL;DR / Recommendation

Both ideas are realistic, but **build them in the order that gives value fastest and avoids the hardest problem first.** Start with **Idea 1's simplest architecture**: the phone captures audio and does the transcript (using an existing app or a thin custom recorder + on-device speech-to-text), drops a plain text/JSON file into the shared folder the suite already watches, and the **structured-note extraction happens on the laptop** using the existing staging/Review-Queue "accept a file into a record" pattern already built for other imports. Don't try to put an LLM on the phone — phones are memory-constrained too, and the laptop is a much better place to run a reasoning model. For Idea 2, **yes, a genuinely small (3–4B parameter) quantized reasoning model can run on a Windows laptop with under 16GB RAM, CPU-only** — the best current fit is **Phi-4-mini-reasoning (3.8B, Q4_K_M GGUF, ~3.2GB RAM total)**, which comfortably leaves 12+GB of the 16GB budget for Windows, the browser, and the admin suite itself. Speed will be modest (10–20 tokens/sec on a typical business laptop CPU) — fine for a background "summarize this transcript" job that runs after a call, not fine for a live chat experience. NZ call-recording law is on your side (one-party consent), but the Privacy Act 2020 still requires telling the other person a recording is happening, especially since these are ACC claimant/employer calls involving personal information.

---

## 2. Idea 1: Call-capture companion app

### What already exists (don't rebuild this)

There is a mature market of "record → transcribe → structured summary" tools already, several explicitly marketed at exactly this NZ-relevant use case (insurance/claims phone work):

- **Plaud Note / Note Pro** — a small hardware clip-on that attaches to the phone and picks up call audio via a vibration sensor, paired with an app that transcribes (via ChatGPT-5/Gemini/Claude) and applies structured "summary templates" (the vendor's own marketing literally uses an insurance-agent example: *"Client confirmed renewal at current coverage level... Follow-up call scheduled for Thursday at 10 AM."*). ([plaud.ai](https://www.plaud.ai/products/plaud-note-ai-voice-recorder), [Trusted Reviews](https://www.trustedreviews.com/reviews/plaud-note-pro), [5 Best AI Note Takers for Phone Calls in 2026 — Plaud](https://www.plaud.ai/blogs/articles/5-best-ai-note-takers-for-phone-calls-in-2026))
- **Otter.ai / Fireflies.ai** — software-only, but they work by joining VoIP/Zoom/Teams calls as a bot; they generally do **not** capture ordinary cellular/landline calls unless the org's phone system is VoIP. Not a fit unless the office phone system is already VoIP. ([withallo.com](https://www.withallo.com/blog/best-call-transcription-software-apps))
- **Rev Call Recorder, TapeACall (iPhone), Cube ACR (Android), Allo** — phone-native apps that record calls directly (iPhone needs a "merge call" trick due to Apple's restrictions; Android has more native options but recording legality/availability is carrier- and region-dependent). ([withallo.com](https://www.withallo.com/blog/best-call-transcription-software-apps))

None of these plug directly into a custom IndexedDB admin suite, but several (Plaud in particular) export transcripts/summaries that could be dropped into a watched folder — i.e. you may not need a bespoke phone app at all for the recording+transcription part, only for the "hand this off to ACCAdminsuite" part.

### NZ call-recording consent law (short version)

- New Zealand is a **one-party consent** jurisdiction: under the **Crimes Act 1961, s 216B**, any participant in a call can lawfully record it without telling the other party — recording your own call is not "interception." ([RecordingLaw.com](https://www.recordinglaw.com/world-laws/world-recording-laws/new-zealand-recording-laws/), [RecordPhoneCall.com](https://recordphonecall.com/legal/new-zealand/))
- **But** the **Privacy Act 2020** (specifically Information Privacy Principle 3) applies whenever an *agency* (i.e. an organisation, not a private individual) is collecting personal information, and requires disclosing that a call is being recorded and why — this is a *separate* obligation from the Crimes Act consent question. ([Sprintlaw NZ](https://sprintlaw.co.nz/articles/is-it-legal-to-record-conversations-in-new-zealand/), [Waboom AI — NZ Privacy Act 2020 AI Voice Agent Rules](https://www.waboom.ai/blog/nz-privacy-act-2020-ai-voice-agent-compliance))
- Practical takeaway for ACC claims/billing calls (these routinely involve claimants' health/personal information): **legally you can record without asking, but you should still say something like "just so you know, I'm taking notes/recording this call for our records" at the start** — it's cheap, defensible, and matches IPP 3. This is a policy/wording decision for the org, not a coding decision — flag it as an open question below.
- One more nuance found in the research: even where recording is *legally* permitted, NZ employment-law commentary (Lane Neave, Wynn Williams) has flagged that *secretly* recording **colleagues/employees** (as opposed to external callers) can still breach the good-faith duty under the Employment Relations Act — not directly relevant to claimant calls, but relevant if this pattern were ever extended to internal calls.

### Architecture options considered

**(a) Phone records + transcribes → syncs a plain text file to the shared folder** (recommended)
The phone side stays as simple as possible: press-to-record, on-device or cloud speech-to-text, drop a `.txt`/`.json` transcript into the same shared/synced folder the suite already watches for other imports. The laptop-side admin suite ingests it through the **existing staging/Review-Queue "accept a file into a record" pattern** (the same pattern already used for remittance PDFs and other imports elsewhere in this team's suites) and only *there* does the "break down into structured notes" step, using the small local LLM from Idea 2 (or, at first, no LLM at all — just a manual "paste the raw transcript into a new call-note task" step while the extraction gets built out).
This keeps the phone app trivial (one screen, one button, no LLM, no complex sync logic) and puts all the interesting/fragile logic (structured extraction, matching to the right patient/claim record) on the laptop where it's easier to iterate, debug, and fix without an app-store release cycle.

**(b) Phone app does its own on-device "breakdown into structured notes" step**
Would require running an LLM *on the phone*, which is a much tighter memory/battery/thermal budget than a laptop (and iOS in particular restricts background CPU-intensive work). Realistically only feasible with a genuinely tiny model (sub-1B, e.g. MiniCPM5-1B) doing a much shallower version of the extraction, and would duplicate logic that already needs to exist on the laptop side anyway (record matching, schema mapping to the suite's own data model). Not recommended as a first step.

**(c) Phone captures raw transcript only; laptop does 100% of the structuring**
This is really the same as (a) — the difference is only about how much cleanup the phone app itself does to the transcript before sending it (e.g. does it call a cloud STT API and get a clean transcript back, or does it hand off nearly-raw audio/partial text). Functionally (a) and (c) collapse into the same recommended shape.

### Recommendation

**Architecture (a)/(c): phone captures + transcribes only, structuring happens on the laptop.** Given this is a two-person-ish dev effort, not a startup:

1. **Cheapest possible first version — don't build a phone app at all.** Buy/trial one Plaud Note (or similar), or just use the iPhone/Android's own voice memo + call-recording workaround, manually export/AirDrop/email the transcript, and build *only* the laptop-side "paste a raw transcript in, get structured notes out" feature first. This validates whether the structuring step (Idea 2) is actually useful before investing in any phone app at all.
2. **If that laptop-side step proves valuable**, then build the minimal companion app: one button (start/stop), on-device or cloud transcription, and a "send to admin suite" action that just writes a text file to the shared folder — reusing the existing staging/Review-Queue ingestion pattern rather than inventing a new sync mechanism.
3. Do **not** attempt to build the structured-extraction reasoning step into the phone app itself. That's a laptop-side job.

### Rough build effort (very rough, non-binding)

- Step 1 (validate on laptop with manually-supplied transcripts, no phone app): a few days — mostly UI for "paste/import a transcript" + wiring the local LLM call + a review/edit screen before it's accepted into a record.
- Step 2 (minimal phone app, if step 1 validates): 1–3 weeks depending on platform (a bare-bones Android app using an existing on-device STT library like whisper.cpp is more achievable solo than an equivalent iOS app, given iOS's stricter call-audio-access restrictions — see Open Questions).

---

## 3. Idea 2: Small on-device reasoning models — August 2026 snapshot

Sources checked: Hugging Face model cards, GitHub READMEs (llama.cpp ecosystem), an arXiv paper (SmallThinker, July 2025), Google's own Gemma model-card page, and several third-party hardware-requirement/benchmark aggregator sites (cross-checked against vendor pages, not relied on alone). Hacker News searches on "small local LLM 2026" mostly surfaced tooling/orchestration posts (adaptive reasoning depth, token budgeting) rather than new model announcements — the actual model releases are better tracked via Hugging Face/GitHub directly, which is what the table below is based on.

| Model | Params | Quantization used | Quantized file size | Approx. total RAM to run | Approx. CPU tokens/sec | Reasoning capability notes | License |
|---|---|---|---|---|---|---|---|
| **Phi-4-mini-reasoning** | 3.8B (dense) | Q4_K_M GGUF | 2.49 GB | ~3.2 GB (weights + llama.cpp overhead; +1–2GB if pushing long context) | ~10–20 tok/s on a modern 8-core CPU | Purpose-tuned for step-by-step reasoning: 94.6% MATH-500, 52.0% GPQA Diamond, 57.5% AIME-style — punches well above its size on structured/logical tasks specifically | MIT |
| **Phi-4-mini (instruct, non-reasoning variant)** | 3.8B (dense) | Q4_K_M GGUF | 2.49 GB | ~3.2 GB | ~10–20 tok/s (8-core CPU) | 67.3% MMLU, 88.6% GSM8K, 64.0% MATH — strong general instruction-following, faster/cheaper than the reasoning variant for tasks that don't need explicit chain-of-thought | MIT |
| **Qwen3-4B-Instruct-2507** | 4B (dense) | Q4_K_M GGUF | 2.33 GB | ~3.8 GB | Reported CPU speeds vary widely by hardware (~5 tok/s on a weak NAS CPU up to ~20–30 tok/s on a decent laptop CPU) | Has a built-in "thinking mode" toggle for explicit chain-of-thought reasoning at the cost of ~2–3x more tokens per response; solid general-purpose small model | Apache 2.0 |
| **SmallThinker-4B-A0.6B** | 4B total / 0.6B active (sparse MoE, purpose-built for local devices) | Q4_0 GGUF | not separately listed (paper reports memory, not file size) | **~1 GB** | **20+ tok/s** on "ordinary consumer CPUs" per the authors' own benchmark | Architected from scratch for local/edge deployment (sparse MoE + prefetching to hide slow-storage latency); authors report it beating some larger models on their benchmark suite — promising but newer/less battle-tested than Phi/Qwen | Apache 2.0 (PowerInfer/OpenBMB-adjacent research release) |
| **MiniCPM5-1B** | 1B (dense) | GGUF (various) | sub-1GB | **~1–2 GB** | Fast even on CPU-only (exact figure not independently benchmarked in our sources; vendor notes "pure CPU also works, but is slower" than GPU) | 128K context, native "Think / No Think" modes, positioned as 1B-class open-source SOTA for tool use/reasoning — but at 1B parameters, genuine multi-step reasoning quality is meaningfully weaker than the 3–4B models above | Apache 2.0 |
| **Gemma 3n E4B** | 8B raw / ~4B "effective" (MoE-style parameter offloading) | Q4_K_M GGUF | not separately listed | ~8 GB system RAM CPU-only | ~10–20 tok/s CPU-only (much faster with any GPU) | Explicitly **not** a reasoning model — "provides direct responses without extended chain-of-thought" per its own benchmark writeup; good general knowledge/instruction-following, weaker fit for this specific task | Gemma license (custom, permissive but with usage terms) |

Sources: [Mungert/Phi-4-mini-reasoning-GGUF (HF)](https://huggingface.co/Mungert/Phi-4-mini-reasoning-GGUF), [unsloth/Phi-4-mini-reasoning-GGUF (HF)](https://huggingface.co/unsloth/Phi-4-mini-reasoning-GGUF), [TinyWeights — Run Phi-4-mini Locally](https://tinyweights.dev/posts/run-phi-4-mini-locally/), [codersera — Run Phi-4 Mini on Linux](https://codersera.com/blog/run-microsoft-phi-4-mini-on-linux-a-step-by-step-guide/), [localmodel.run — Qwen3 8B](https://localmodel.run/model/qwen3-8b), [llmhardware.io — Qwen3 Hardware Requirements](https://llmhardware.io/guides/qwen3-hardware-requirements), [Dhptl/Qwen3-4B-Instruct-2507-GGUF (HF)](https://huggingface.co/Dhptl/Qwen3-4B-Instruct-2507-GGUF), [XDA — running AI on a NAS at 5 tok/s](https://www.xda-developers.com/running-ai-on-nas-5-tokens-per-second/), [SmallThinker arXiv paper](https://arxiv.org/pdf/2507.20984), [OpenBMB/MiniCPM (GitHub)](https://github.com/OpenBMB/MiniCPM?tab=readme-ov-file), [openbmb/MiniCPM5-1B (HF)](https://huggingface.co/openbmb/MiniCPM5-1B), [google/gemma-3n-E4B (HF)](https://huggingface.co/google/gemma-3n-E4B), [BestLLMfor — Gemma 3n E4B](https://bestllmfor.com/catalog/gemma3n-e4b/), [Google AI — Gemma 4 model overview](https://ai.google.dev/gemma/docs/core) (noted as an even newer generation released after Gemma 3n, with an explicit Q4_0 4-bit RAM table: E2B ≈ 2.9GB, E4B ≈ 4.5GB at 4-bit — worth a follow-up look if Gemma is reconsidered later).

**On-device speech-to-text (needed regardless of which LLM is used, for turning audio into a transcript in the first place):** **whisper.cpp** is the clear standard — open-source (MIT), runs offline on Windows/Mac/Android/iOS, models range from 75MB (tiny) to 2.9GB (large-v3), and a mid-size "base"/"small" model at int8 quantization uses well under 500MB RAM with sub-2% word-error-rate degradation versus full precision. ([ggml-org/whisper.cpp (GitHub)](https://github.com/ggerganov/whisper.cpp/), [MVP Factory — Fine-Tuning Whisper.cpp](https://mvpfactory.io/blog/fine-tuning-whisper-cpp-for-on-device-speech-to-text-in-kmp-quantization/), [VoicePing offline STT benchmark](https://voiceping.net/en/blog/research-offline-speech-transcription-benchmark/)). This is a **separate, smaller, and easier problem than the reasoning-LLM question** — transcription is well-solved at this scale; the harder open question is the structuring/reasoning step.

---

## 4. Feasibility verdict for <16GB RAM, CPU-only laptops

**Yes, this fits — comfortably, with room to spare.** None of the recommended models need anywhere close to 16GB:

- **Phi-4-mini-reasoning at Q4_K_M needs ~3.2GB of RAM total.** On a 16GB laptop that leaves ~12–13GB for Windows, the browser, and the admin suite's own IndexedDB/Electron-or-browser footprint — very safe headroom, not a tight squeeze.
- Even the larger options in the table (Qwen3-4B at ~3.8GB, Gemma 3n E4B at ~8GB) fit under 16GB, though Gemma 3n's own benchmark says it isn't tuned for reasoning-style output in the first place, so it's a weaker fit for this specific task regardless of RAM.
- The real constraint isn't memory — it's **speed**. 10–20 tokens/sec CPU-only means a few-hundred-word structured summary could take 20–60+ seconds to generate. That's fine for a background job that runs once after a call ends and shows a "processing..." state, but would feel slow for anything interactive.

**Honest caveat:** none of these small models reason as reliably as a frontier cloud model (GPT-4o-mini-class or better) on genuinely ambiguous or multi-step logic. But the actual task described — *"take a rough call transcript and extract structured claim/billing fields"* — is narrower than general reasoning: it's closer to information extraction + light classification (who is the claimant, what was discussed, is there a follow-up action, what's the claim/employer reference) than to open-ended multi-step problem solving. This is exactly the kind of task where a 3–4B instruction-tuned model (Phi-4-mini or Qwen3-4B) tends to be "good enough," even though it would score noticeably below a frontier model on a hard math/logic benchmark.

**Recommendation:** start with **Phi-4-mini-reasoning** (Q4_K_M) as the default local model — it's specifically tuned for structured step-by-step output, has an MIT license (no restrictions on internal commercial/health-sector use), and its RAM footprint is the smallest of the "real reasoning" options. Keep **Qwen3-4B-Instruct-2507** as a fallback/comparison, since its "thinking mode" toggle and Apache 2.0 license make it a reasonable second option to A/B against on real transcripts.

**Hybrid option (worth keeping in mind, not committing to now):** run the small local model for the routine/first-pass extraction, and only fall back to a cloud API (existing OpenAI/Anthropic/etc. account, if the org already has one) for calls the local model flags as low-confidence or unusually complex. This avoids ongoing per-call cloud cost for the common case while keeping a safety net for the hard cases — but adds complexity (a confidence-routing step) that isn't needed for a first proof-of-concept.

---

## 5. Suggested next step (proof-of-concept, not full build)

1. **Pick one real (synthetic, not real-PHI) sample call transcript** — write a realistic but fake ACC claimant call (5–10 minutes' worth of dialogue, the kind of thing this admin suite already needs synthetic fixtures for elsewhere).
2. **Download Phi-4-mini-reasoning (Q4_K_M GGUF) and run it via Ollama or llama.cpp directly on the actual target laptop** (or the closest available stand-in) — this is a same-day task, no coding needed yet, just `ollama pull` + a prompt. Confirm actual RAM usage and generation speed on that specific hardware, since all the RAM/speed figures above are from other people's hardware, not this laptop.
3. **Write one fixed extraction prompt** (e.g. "Given this call transcript, extract: claimant name/NHI if mentioned, claim number if mentioned, topic discussed, any commitments/follow-up actions, next call-back date if any — output as JSON") and run it against 3–5 synthetic transcripts of varying messiness (clean vs. rambling vs. multiple topics in one call).
4. **Manually grade the output** — not a formal benchmark, just: did it get the claim number right, did it invent anything, did it miss an obvious action item. This tells you in an afternoon whether the "good enough" claim above actually holds for this specific task, before any phone app or pipeline work begins.
5. **Only if step 4 looks promising**, move to wiring a "paste raw transcript → get structured notes → review before accepting into a record" screen into the admin suite (reusing the existing Review-Queue accept-into-record UI pattern), still with manually-supplied transcripts and no phone app yet.
6. **Phone app work is the last step**, not the first — see Idea 1 recommendation above.

## 6. Open questions / assumptions

- **Exact laptop specs are unknown.** This report assumes "ordinary business Windows laptop, <16GB RAM, no dedicated GPU" per the brief, but the actual CPU (core count, generation) meaningfully affects tokens/sec — worth checking `Get-ComputerInfo` / Task Manager specs on the real target machine before the proof-of-concept above.
- **Exact org call-recording compliance policy is unknown.** This report covers the legal *floor* (NZ one-party consent + Privacy Act 2020 IPP 3 disclosure duty) but doesn't know if the organisation has its own stricter internal recording policy — worth a quick check before shipping anything, separate from the technical work.
- **iOS vs. Android for a future phone app is undecided.** iOS restricts direct access to call audio more than Android does (most iPhone call-recording apps use a "merge call with a recording line" workaround rather than true native recording); if a phone app is eventually built, Android is very likely the easier/cheaper platform to start with, and this affects which existing tool (Plaud, Cube ACR, etc.) makes sense as an interim bridge.
- **Whether Phi-4-mini-reasoning actually performs well on *this specific* extraction task is unverified** — the benchmark numbers above are on general math/reasoning benchmarks (MATH-500, GPQA, GSM8K), not on anything resembling "extract structured billing fields from a rambling phone transcript." Step 2–4 of the suggested next step exists specifically to answer this before committing further.
- **Gemma 4 (mentioned briefly in the table sources) looks like a newer generation than Gemma 3n** as of this research date but wasn't benchmarked as thoroughly in the sources found — worth a fresh look if Gemma is reconsidered later, since its own published Q4_0 RAM figures (E4B ≈ 4.5GB) are competitive with Phi-4-mini.
