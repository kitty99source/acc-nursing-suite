# Local AI chat speed — maxing CPU/RAM utilization (Aug 2026)

**Date:** 2026-08-04 (updated same day — owner clarification: prefer *push the machine harder*
on the current model, not a primary “Fast vs Reasoning” product mode)  
**Scope:** Make AdminSuite’s on-device Ollama + `phi4-mini-reasoning` feel usable on CPU-only
Windows laptops (&lt;16GB RAM), without cloud APIs, without admin rights preferred, without
weakening the hard grounding gate.  
**Related:** `docs/ai-features-setup.md`, `src/lib/aiService.ts`,
`docs/research/on-device-reasoning-and-call-capture-2026-08.md`.

---

## 1. Direct answer: “Can we ask it to use more memory / push compute harder?”

**Partial — yes for CPU threads / process priority / power plan / keeping the model resident;
no for “pour more RAM into decode and go faster.”**

| Ask | Verdict | Why |
| --- | --- | --- |
| Use more **CPU cores** | **Yes, try** | Pass `options.num_thread` (Settings). Ollama defaults to ≈ physical performance cores; if Task Manager shows idle cores during generation, raise threads. Using *all* logical/hyperthreads can **slow** decode (cache thrashing). ([Ollama #2929](https://github.com/ollama/ollama/issues/2929), [Ollama #6876](https://github.com/ollama/ollama/issues/6876)) |
| Use more **RAM** to go faster | **Only up to a point** | Keeping the model loaded (`keep_alive: -1` / Settings checkbox) avoids cold-reload stalls (~10–60s). Larger `num_ctx` / KV cache **uses more RAM but usually makes inference slower**, not faster. Decode is memory-bandwidth + CPU bound, not “idle RAM sitting unused.” |
| Higher **process priority** / **power plan** | **Yes** | Windows Balanced/Battery saver throttles clocks. Best performance + Above-normal priority for `ollama.exe` can help when the OS is scheduling other work. No AdminSuite code change required. |
| Larger **batch** (`num_batch`) | **Minor / prefill** | Helps prompt evaluation more than token-by-token decode; raises memory spikes. Not auto-raised in-app (measure first). |
| Flash Attention / KV cache quant | **No on CPU-only Ollama** | FA is GPU-backend gated; KV quant needs FA ([Ollama FAQ](https://docs.ollama.com/faq)). Silent no-op or irrelevant here. |
| Speculative decoding | **No clean CPU Windows path** | Ollama MTP/spec work is concentrated on Apple Silicon MLX ([PR #15980](https://github.com/ollama/ollama/pull/15980)). Do not claim it for this laptop. |
| `OLLAMA_NUM_THREAD` env var | **Unreliable** | Not a supported server config; ignored in practice ([#10476](https://github.com/ollama/ollama/issues/10476), [#4477](https://github.com/ollama/ollama/issues/4477)). Use API `num_thread` or Modelfile `PARAMETER`. |

**If cores are already pegged near 100% during generation**, you are already pushing compute —
extra threads/RAM will not fix “incredibly slow.” Remaining wall-clock is mostly **how many
tokens the model must emit** (especially `<think>` on `phi4-mini-reasoning`) at ~10–20 tok/s.

---

## 2. Top actions ranked by expected impact (current hardware + model)

1. **Confirm utilization in Task Manager while a reply streams** (see §4).  
   - Low CPU → raise threads / power plan / priority.  
   - High CPU → stop chasing “more RAM”; consider shorter answers / optional instruct model.
2. **Settings → Push this laptop harder → try ~Physical threads, then All logical if still idle**  
   + enable **Keep model loaded in RAM**. (Shipped this pass.)
3. **Windows Best performance power mode + optional Above-normal priority for `ollama.exe`.**
4. **Secondary:** optional instruct tag `phi4-mini` (Settings details) — drops forced CoT token
   tax; same ~2.5GB class. Not the primary product mode.
5. **Already shipped earlier:** `keep_alive` 30m default, `num_ctx` 8192 (not 128K), streaming,
   grounding gate (skips Ollama when ungrounded), rolling summarization, temp 0.3.

---

## 3. What already applies / already done in this app

| Lever | Status |
| --- | --- |
| Streaming `/api/chat` | Done |
| Context budget + refuse oversized prompts | Done |
| Rolling conversation summarization | Done |
| Cooler temperature (`0.3`) | Done |
| Hard grounding gate (skip Ollama when ungrounded) | Done |
| `num_ctx` capped at 8192 | Done (smaller than model max → less KV RAM, faster) |
| Default `keep_alive: 30m` | Done |
| Settings: explicit `num_thread` presets + custom | **Done this pass** |
| Settings: pin model in RAM (`keep_alive: -1`) | **Done this pass** |
| Optional instruct vs reasoning model | Done (secondary UI) |
| Flash Attention / KV quant / `OLLAMA_NUM_PARALLEL` raise | Correctly **not** applied for CPU-only |

---

## 4. How to check CPU% during a generation (owner)

1. Start a grounded chat question so the model actually runs (not the instant refuse path).
2. Open **Task Manager** (`Ctrl+Shift+Esc`):
   - **Performance → CPU**: overall utilization graph.
   - **Details**: sort by CPU; watch `ollama.exe` / runner processes.
3. Interpret:
   - **~20–50% overall** on an 8-logical-core laptop often means ~2–4 cores busy → try raising
     `num_thread` toward physical or logical count.
   - **~90–100% overall** → already compute-bound; more threads unlikely to help; CoT length /
     model choice dominate.
4. Also watch **Memory**: Phi-4-mini Q4 is ~3GB resident when loaded. If RAM is near full and
   disk thrashing, *reduce* loaded models / close apps — more `num_ctx` will hurt.

---

## 5. Owner-actionable knobs (no admin required for the core path)

### In AdminSuite Settings (shipped)

- **CPU threads:** Auto / ~Physical / All logical / custom → `options.num_thread`.
- **Keep model loaded in RAM:** `keep_alive: -1`.
- **Optional instruct model:** `ollama pull phi4-mini` then select under the secondary details.

### Windows / Ollama outside the app

| Action | Notes |
| --- | --- |
| Power mode → Best / High performance | Settings → System → Power & battery |
| Task Manager → `ollama.exe` → Set priority → Above normal | Session-only |
| `OLLAMA_KEEP_ALIVE=30m` or `-1` (user env) | Belt-and-suspenders; app already sends keep_alive ([FAQ](https://docs.ollama.com/faq)) |
| Modelfile `PARAMETER num_thread N` + `ollama create` | Permanent override if preferred over per-request |
| **Skip:** `OLLAMA_FLASH_ATTENTION`, `OLLAMA_KV_CACHE_TYPE` on CPU-only | No benefit |
| **Skip:** raising `OLLAMA_NUM_PARALLEL` for single-user chat | Can worsen latency |

### Context size vs speed

- Larger `num_ctx` → larger KV cache → more RAM, usually **slower** tok/s  
  ([num_ctx trap writeup](https://bric.pe.kr/blog/ollama-num-ctx-kv-cache-trap-tokens-per-second)).
- We already pin **8192**. Shrinking further (e.g. 4096) can help a bit if prompts are small,
  but risks the contract-chip overflow we hit before — not the first lever.

### `num_batch` / `num_gpu` / mmap

- `num_gpu`: irrelevant / 0 on CPU-only.
- `use_mmap`: default on; forcing it does not “use more RAM for speed.”
- `num_batch`: larger can speed **prefill**; decode remains the long pole for chat. Left at
  Ollama default unless owner measures a win.

---

## 6. Code / config changes in AdminSuite (this pass)

1. `settings.aiNumThread` + Settings presets (auto / physical estimate / all logical / custom).
2. `settings.aiKeepModelLoaded` → `keep_alive: -1` when on.
3. `buildOllamaOptions` / `resolveKeepAlive` / `detectLogicalProcessors` in `aiService.ts`;
   wired through chat stream, summarization, and duplicate-check.
4. Optional instruct/reasoning profile kept under a **secondary** details block (not the lead UX).
5. Docs: this note + `docs/ai-features-setup.md`.

---

## 7. Secondary: model / quant options (after compute is maximized)

| Option | Size | Tradeoff |
| --- | --- | --- |
| Stay on `phi4-mini-reasoning` Q4_K_M | ~2.5 GB | Best deliberation; CoT tax on CPU |
| `phi4-mini` instruct | ~2.5 GB | Much less generated tokens; slightly less “reasoning” style |
| `qwen2.5:3b` | ~1.9 GB | Common CPU pick; different behaviour |
| `gemma3:1b` | ~0.8 GB | Fastest class; weaker compliance nuance |
| Q4_0 / Q3 of reasoning tag | slightly smaller | Real quality loss; weak evidence of big tok/s win for this arch |

Grounding gate unchanged for all of the above.

---

## 8. Sources (sampled)

- [Ollama FAQ — context, Flash Attention, KV cache, keep_alive, concurrency](https://docs.ollama.com/faq)
- [Ollama API options including `num_thread` / `num_batch`](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [Ollama #2929 — default threads ≈ physical cores; HT thrashing](https://github.com/ollama/ollama/issues/2929)
- [Ollama #6876 — models not using full CPU; set `num_thread`](https://github.com/ollama/ollama/issues/6876)
- [Ollama #10476 / #4477 — `OLLAMA_NUM_THREAD` not a real/reliable env](https://github.com/ollama/ollama/issues/10476)
- [Glukhov — Intel P/E cores + `num_thread` experiments](https://www.glukhov.org/llm-performance/ollama/ollama-cpu-cores-usage/)
- [num_ctx / KV spill tok/s trap](https://bric.pe.kr/blog/ollama-num-ctx-kv-cache-trap-tokens-per-second)
- [HN / LocalLLaMA-class CPU model sizing](https://news.ycombinator.com/item?id=46518573),
  [8GB CPU Ollama picks](https://ai-jupyter.com/local-llm-real-world-test/best-ollama-models-for-8gb-ram)
- Speculative/MTP on MLX: [Ollama PR #15980](https://github.com/ollama/ollama/pull/15980)
