import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData } from './sampleData';
import { _resetKnowledgeCorpusCacheForTests } from './ai/knowledgeCorpus';
import type { AppData, Claim, Contract, Patient } from '../types';
import {
  AI_ASSISTANT_SYSTEM_PROMPT,
  buildCaseStageSummary,
  buildChatMessages,
  buildComplianceRuleSummary,
  buildContextBlock,
  makeContractChip,
  makePatientChip,
  serializeChipContext,
  serializeContractContext,
  serializePatientContext,
} from './aiChatContext';
import { buildKnowledgeBaseSections } from './ai/knowledgeBase';

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'ct1',
    providerName: 'SAMPLE — Wellnz Limited',
    customerNumber: '1216',
    claimsEmail: 'claims@example.test',
    effectiveFrom: '2026-01-01',
    effectiveTo: '',
    serviceCodesCovered: ['NS04', 'NS05'],
    rateTable: [{ serviceCode: 'NS04', description: 'District nursing visit', rate: 85.5 }],
    notes: 'Synthetic test fixture.',
    ...overrides,
  };
}

function patient(overrides: Partial<Patient> = {}): Patient {
  return { id: 'p1', name: 'Jane Doe', nhi: 'ABC1234', dob: '1980-05-01', notes: 'Prefers morning visits', ...overrides };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    patientId: 'p1',
    acc45Number: '',
    claimNumber: 'CL-1',
    poNumber: '',
    injuryDescription: 'Fractured wrist',
    type: 'original',
    status: 'active',
    day1Date: '2026-01-10',
    caseStage: 'awaiting_acc',
    ...overrides,
  };
}

function dataWith(patients: Patient[], claims: Claim[] = []): AppData {
  return { ...emptyData(), patients, claims };
}

describe('serializePatientContext', () => {
  it('includes the real patient fields and claim summaries', () => {
    const p = patient();
    const data = dataWith([p], [claim()]);
    const text = serializePatientContext(p, data);
    expect(text).toContain('Jane Doe');
    expect(text).toContain('ABC1234');
    expect(text).toContain('Prefers morning visits');
    expect(text).toContain('CL-1');
    expect(text).toContain('Waiting on ACC');
  });

  it('says "none on file" when the patient has no claims, and does not invent data', () => {
    const p = patient({ nhi: '', dob: '', notes: '' });
    const data = dataWith([p], []);
    const text = serializePatientContext(p, data);
    expect(text).toContain('Claims: none on file');
    expect(text).toContain('not on file');
    expect(text).toContain('Notes: none');
  });
});

describe('serializeChipContext', () => {
  it('resolves a patient chip to its live record', () => {
    const p = patient();
    const data = dataWith([p]);
    const chip = makePatientChip(p);
    expect(serializeChipContext(chip, data)).toBe(serializePatientContext(p, data));
  });

  it('degrades gracefully when the chipped record has since been deleted', () => {
    const data = dataWith([]);
    const chip = makePatientChip(patient());
    expect(serializeChipContext(chip, data)).toContain('record no longer found');
  });

  it('resolves a contract chip to its live record', () => {
    const c = contract();
    const data: AppData = { ...emptyData(), contracts: [c] };
    const chip = makeContractChip(c);
    expect(chip.type).toBe('contract');
    expect(serializeChipContext(chip, data)).toBe(serializeContractContext(c));
  });

  it('degrades gracefully when the chipped contract has since been deleted', () => {
    const data: AppData = { ...emptyData(), contracts: [] };
    const chip = makeContractChip(contract());
    expect(serializeChipContext(chip, data)).toContain('record no longer found');
  });

  it('works when data.contracts is entirely absent (optional/additive field)', () => {
    const data: AppData = { ...emptyData() };
    delete data.contracts;
    const chip = makeContractChip(contract());
    expect(serializeChipContext(chip, data)).toContain('record no longer found');
  });
});

describe('serializeContractContext', () => {
  it('includes the real contract fields — rate table, codes covered, dates', () => {
    const text = serializeContractContext(contract());
    expect(text).toContain('SAMPLE — Wellnz Limited');
    expect(text).toContain('1216');
    expect(text).toContain('NS04, NS05');
    expect(text).toContain('$85.50');
    expect(text).toContain('District nursing visit');
    expect(text).toContain('ongoing');
  });

  it('says "none on file" / "not on file" rather than inventing data for a mostly-empty contract', () => {
    const c = contract({ customerNumber: '', claimsEmail: '', serviceCodesCovered: [], rateTable: [], notes: '' });
    const text = serializeContractContext(c);
    expect(text).toContain('not on file');
    expect(text).toContain('none on file');
    expect(text).toContain('Notes: none');
  });

  // 2026-08-04 context-overflow bug fix: a real 39-row Contract chip (Allied Health schedule),
  // serialized with the old always-verbose-description logic, combined with knowledge-retrieval
  // context to plausibly exceed the model's context window and time out — see aiService.ts
  // DEFAULT_NUM_CTX comment for the full incident writeup.
  describe('many-row rate tables (compact view)', () => {
    function bigRateTable(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        serviceCode: `PT${String(i).padStart(2, '0')}`,
        description:
          'A fairly long, realistic service item description matching the real Allied Health schedule rows, ' +
          'covering things like initial consultation requirements and clinical documentation expectations.',
        rate: 50 + i,
      }));
    }

    it('switches to a compact code+price view (no verbose descriptions) once a contract has many rows', () => {
      const c = contract({ rateTable: bigRateTable(39) });
      const text = serializeContractContext(c);
      expect(text).toContain('compact view');
      expect(text).not.toContain('A fairly long, realistic service item description');
      expect(text).toContain('PT00: $50.00');
      expect(text).toContain('PT38: $88.00');
    });

    it('keeps the full verbose per-row description for a small rate table (existing behaviour unaffected)', () => {
      const c = contract({ rateTable: bigRateTable(5) });
      const text = serializeContractContext(c);
      expect(text).not.toContain('compact view');
      expect(text).toContain('A fairly long, realistic service item description');
    });

    it('produces a reasonably bounded chip payload for a real-world-sized (39-row) contract — the actual crashing case', () => {
      const c = contract({ rateTable: bigRateTable(39) });
      const text = serializeContractContext(c);
      // The real incident's old verbose serialization of this same 39-row shape was ~6.7K
      // characters; the compact view should be dramatically smaller.
      expect(text.length).toBeLessThan(3000);
    });

    it('caps the number of rows actually listed even for a very large schedule (e.g. Elective Surgery-sized), with a clear "more not shown" note', () => {
      const c = contract({ rateTable: bigRateTable(300) });
      const text = serializeContractContext(c);
      expect(text).toContain('more code(s) not shown');
      expect(text).toContain('ask about a specific code');
      // Bounded regardless of how many rows the real schedule has.
      expect(text.length).toBeLessThan(4000);
    });
  });
});

describe('buildContextBlock', () => {
  it('returns an empty string with no chips', () => {
    expect(buildContextBlock([], dataWith([]))).toBe('');
  });

  it('joins multiple chips with a separator', () => {
    const a = patient({ id: 'a', name: 'Alice' });
    const b = patient({ id: 'b', name: 'Bob' });
    const data = dataWith([a, b]);
    const block = buildContextBlock([makePatientChip(a), makePatientChip(b)], data);
    expect(block).toContain('Alice');
    expect(block).toContain('Bob');
    expect(block).toContain('---');
  });
});

describe('grounding system prompt', () => {
  it('is built from the real compliance rules, not invented text', () => {
    const summary = buildComplianceRuleSummary();
    expect(summary).toContain('NS04');
    expect(summary).toContain('Schedule');
    // Full rulebook lives in buildKnowledgeBaseSections (tests/docs); production injects only
    // relevant rules per turn via groundingGate — the base prompt no longer dumps every rule.
    expect(buildKnowledgeBaseSections().join('\n')).toContain(summary);
  });

  it('lists the real case-workflow stages in order', () => {
    const stages = buildCaseStageSummary();
    expect(stages).toContain('Not started');
    expect(stages).toContain('Closed');
    expect(buildKnowledgeBaseSections().join('\n')).toContain(stages);
  });

  it('states it runs locally and never invents ACC policy', () => {
    expect(AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase()).toContain('locally');
    expect(AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase()).toContain('do not invent');
  });

  // 2026-08-04 owner-reported quality bugs: the model denied having document access despite real
  // retrieved excerpts sitting in its own context, and separately hallucinated a concrete place
  // name (San Diego) the user never mentioned. Both are prompt-framing gaps, not hardware/speed
  // issues — regression guards below.
  it('explicitly tells the model it already has real document access and must not deny it', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('when document excerpts are present');
    expect(lower).toContain('already been retrieved');
    expect(lower).toContain('never say');
    expect(lower).toContain('cannot access external documents');
  });

  it('includes an explicit groundedness instruction against inventing unstated specifics', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('groundedness');
    expect(lower).toContain('never invent or substitute place names');
  });

  // 2026-08-04 follow-up quality bug: asked about "emergency transport criteria" (a real
  // Auckland-vs-Wellington scenario), the model invented a fully fabricated, confident-sounding
  // "Red/Silver/Gold/Green" ambulance triage system and specific clinical timeframes that appear
  // nowhere in the ingested corpus (confirmed by search — see
  // docs/research/acc-public-contract-sources-2026-08.md §7), then cited "Sources (3)" that were
  // real chunks about completely unrelated topics (Elective Surgery ARTP, Nursing travel/GPT
  // eligibility) as if they supported the invented answer. Regression guards below.
  it('includes a citation-integrity instruction against citing sources that do not actually support the answer', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('citation integrity');
    expect(lower).toContain('do not cite them');
    expect(lower).toContain('do not actually address what the user asked');
  });

  it('explicitly permits saying "I don\'t know" instead of fabricating a confident answer', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('ok, and preferred, to say you do not know');
    expect(lower).toContain('does not have grounded information on that specific topic');
  });

  it('forbids inventing named classification systems/schemes not literally present in the given material', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('named classification systems');
    expect(lower).toContain('red/silver/gold');
  });

  it('explicitly permits asking one brief clarifying question rather than guessing on an ambiguous request', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('ok to ask a brief clarifying question');
    expect(lower).toContain('one short, targeted clarifying question');
  });

  it('tells the model not to reason its way into confident fabrication under its own step-by-step thinking', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('this applies even under your own step-by-step reasoning');
  });

  // 2026-08-04 follow-up: brand-new chat asked "emergency transport criteria" — model <think>
  // invented that the user "provided compliance rules earlier" / "mentioned schedules 5.3, 5.11"
  // (those exist only as static reference material). Then fabricated multi-country flight essays.
  // Static sections are now injected conditionally (groundingGate) — framing lives on the base
  // prompt (history vs reference) AND on buildRelevantStaticSections when rules are injected.
  it('frames static compliance rules as reference material, not prior user messages / conversation history', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('reference material');
    expect(lower).toContain('never claim the user "provided"');
    // Full rulebook helper (tests/docs) still carries the stronger "NOT prior user messages" framing.
    const full = buildKnowledgeBaseSections().join('\n').toLowerCase();
    expect(full).toContain('not prior user messages');
    expect(full).toContain('not conversation history');
  });

  it('locks scope to NZ ACC / this knowledge base and forbids foreign-jurisdiction / encyclopaedia essays', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('new zealand acc');
    expect(lower).toContain('other countries');
    expect(lower).toContain('invented acronyms');
    expect(lower).toContain('aircraft models');
    expect(lower).toContain('medical-encyclopaedia');
    expect(lower).toContain('geneva conventions');
    expect(lower).toContain('never invent a named criteria document');
  });

  it('forbids fake markdown schedule-link citations', () => {
    expect(AI_ASSISTANT_SYSTEM_PROMPT).toContain('[Schedule 5.11.1](#)');
    expect(AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase()).toContain('do not invent markdown links');
  });

  it('requires brief refuse/clarify when no document excerpts were retrieved', () => {
    const lower = AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('no acc document excerpts were retrieved');
    expect(lower).toContain('not a multi-section essay');
    expect(lower).toContain('roughly 80 words');
  });
});

describe('buildChatMessages', () => {
  // Knowledge-corpus retrieval (see knowledgeCorpus.ts) is an async `fetch` of a static local
  // asset — stub it to "unavailable" for these chip/history-focused tests so they stay focused on
  // that behaviour rather than depending on real corpus content; see the dedicated
  // "real ACC document retrieval" describe block below for citation-specific tests.
  beforeEach(() => {
    _resetKnowledgeCorpusCacheForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetKnowledgeCorpusCacheForTests();
  });

  it('assembles a structured messages array: one leading system message (with context folded in), then real history turns, then the new user message', async () => {
    const p = patient();
    const data = dataWith([p]);
    const { messages, contextBlock } = await buildChatMessages({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello, how can I help?' },
      ],
      chips: [makePatientChip(p)],
      data,
      userMessage: "What's the status of this patient's claim?",
    });

    expect(contextBlock).toContain('Jane Doe');
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain(AI_ASSISTANT_SYSTEM_PROMPT);
    expect(messages[0].content).toContain('Context used');
    expect(messages[0].content).toContain('Jane Doe');
    expect(messages[1]).toEqual({ role: 'user', content: 'Hi' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Hello, how can I help?' });
    expect(messages[3]).toEqual({ role: 'user', content: "What's the status of this patient's claim?" });
    // No message anywhere contains a hand-written "User:"/"Assistant:" turn label — the exact
    // pattern that let the model hallucinate more fake turns in the old flattened-string prompt
    // (2026-08-04 bug fix regression guard).
    for (const m of messages) {
      expect(m.content).not.toMatch(/^\s*(User|Assistant):/m);
    }
  });

  it('omits the "Context used" text entirely when there are no chips', async () => {
    const { messages, contextBlock, retrievedSources } = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'What is NS04?',
    });
    expect(contextBlock).toBe('');
    expect(retrievedSources).toEqual([]);
    expect(messages[0].content).not.toContain('Context used (attached by the user');
    // NS04 is static-relevant: base prompt + injected matching rules (no empty-retrieval refuse —
    // the static rules ARE the grounding for this turn).
    expect(messages[0].content.startsWith(AI_ASSISTANT_SYSTEM_PROMPT)).toBe(true);
    expect(messages[0].content).toMatch(/NS04/i);
    expect(messages[0].content.toLowerCase()).toContain('fresh chat turn');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ role: 'user', content: 'What is NS04?' });
  });

  it('caps history to the most recent turns so the messages array stays bounded', async () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content: `turn-${i}`,
    }));
    // In-scope question so the hard grounding gate allows the model call (an off-topic
    // "latest" would refuse before assembly).
    const { messages } = await buildChatMessages({
      history: longHistory,
      chips: [],
      data: dataWith([]),
      userMessage: 'What is NS04 prior approval?',
    });
    const contents = messages.map((m) => m.content);
    expect(contents).not.toContain('turn-0');
    expect(contents).toContain('turn-19');
    // system + 8 history turns + new user message
    expect(messages).toHaveLength(1 + 8 + 1);
  });
});

describe('buildChatMessages — context budget / safety net (2026-08-04 fix)', () => {
  beforeEach(() => {
    _resetKnowledgeCorpusCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetKnowledgeCorpusCacheForTests();
  });

  // Each chunk is padded so three of them reliably exceed a modest numCtx trim trigger —
  // short unpadded fixtures stopped forcing a drop after the hard gate removed the full
  // static rulebook from every system prompt (prompt got smaller; tiny chunks all fit).
  const PAD = ' Additional elective surgery contract operational detail for budget-trim tests.'.repeat(40);
  const SAMPLE_CORPUS = {
    generatedAt: '2026-08-04T00:00:00.000Z',
    chunks: [
      {
        id: 'nurse-og#0',
        sourceDocId: 'nurse-og',
        chunkIndex: 0,
        text:
          'Extended Nursing (NS04) requires ACC prior approval once 25 consultations have been completed or 105 days have passed for elective surgery ARTP contract questions.' +
          PAD,
      },
      {
        id: 'elective-surgery-og#0',
        sourceDocId: 'elective-surgery-og',
        chunkIndex: 0,
        text:
          'The Assessment Report and Treatment Plan (ARTP) process is required before most contracted elective surgery procedures proceed under this contract.' +
          PAD,
      },
      {
        id: 'health-contract-terms-conditions#0',
        sourceDocId: 'health-contract-terms-conditions',
        chunkIndex: 0,
        text:
          'The Supplier must not transmit Personal Information outside New Zealand under this elective surgery contract, per clause 9 of the Standard Terms and Conditions.' +
          PAD,
      },
    ],
  };

  it('drops the lowest-relevance retrieved chunk first when the prompt would exceed the trim-trigger budget, keeping the most relevant one(s)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_CORPUS }));
    const { retrievedSources, contextTooLarge } = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'Tell me about the ARTP process for this elective surgery contract',
      // Modest numCtx + padded sample chunks forces dropping at least one retrieved chunk.
      numCtx: 4200,
    });
    expect(contextTooLarge).toBeFalsy();
    expect(retrievedSources.length).toBeLessThan(SAMPLE_CORPUS.chunks.length);
    expect(retrievedSources.some((s) => s.sourceDocId === 'elective-surgery-og')).toBe(true);
  });

  it('refuses to send (contextTooLarge) rather than exceed the model context window, even after trimming all retrievable chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_CORPUS }));
    const p = patient({ notes: 'x'.repeat(2000) });
    const data = dataWith([p]);
    const result = await buildChatMessages({
      history: [],
      chips: [makePatientChip(p)],
      data,
      userMessage: 'Summarize everything you know',
      // Tiny numCtx that not even the system prompt alone can fit under, once the reserved
      // response budget is subtracted — this is the deliberate "even after best-effort trimming,
      // it's still too big" safety-net case.
      numCtx: 50,
    });
    expect(result.contextTooLarge).toBe(true);
    expect(result.contextTooLargeMessage).toBeTruthy();
    expect(result.contextTooLargeMessage).toContain('try asking about one specific');
    expect(result.messages).toEqual([]);
  });

  it('never trims conversation history while dropping knowledge chunks is enough on its own to fit budget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_CORPUS }));
    const { messages, contextTooLarge, retrievedSources } = await buildChatMessages({
      history: [{ role: 'user', content: 'earlier question' }, { role: 'assistant', content: 'earlier answer' }],
      chips: [],
      data: dataWith([]),
      userMessage: 'Tell me about the ARTP process for this elective surgery contract',
      // With a short prior exchange present, numCtx 4100 + padded chunks still forces dropping
      // at least one chunk while keeping history — confirms history/user survive the SAME trim pass.
      numCtx: 4100,
    });
    expect(contextTooLarge).toBeFalsy();
    expect(retrievedSources.length).toBeLessThan(SAMPLE_CORPUS.chunks.length);
    const contents = messages.map((m) => m.content);
    expect(contents).toContain('earlier question');
    expect(contents).toContain('earlier answer');
    expect(contents).toContain('Tell me about the ARTP process for this elective surgery contract');
  });

  it('fits comfortably under the real default num_ctx for a realistic worst case (one large Contract chip + retrieved chunks), confirming the fix actually resolves the incident', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_CORPUS }));
    const bigContract = contract({
      rateTable: Array.from({ length: 39 }, (_, i) => ({
        serviceCode: `PT${String(i).padStart(2, '0')}`,
        description: 'Realistic Allied Health service item description text of representative length for this schedule.',
        rate: 50 + i,
      })),
    });
    const data: AppData = { ...emptyData(), contracts: [bigContract] };
    const result = await buildChatMessages({
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello, how can I help?' },
      ],
      chips: [makeContractChip(bigContract)],
      data,
      userMessage: 'Summarize this contract for me',
      // Real default — this is the actual production value after the fix.
    });
    expect(result.contextTooLarge).toBeFalsy();
    expect(result.messages.length).toBeGreaterThan(0);
  });

  // 2026-08-04 multi-turn timeout fix: the owner reported the chat working fine for the first
  // ~2-3 exchanges, then hitting "Couldn't reach the local AI model" again in the SAME
  // conversation. Root cause: history was capped by MESSAGE COUNT (`MAX_HISTORY_TURNS` = 8) but
  // NOT by size, and the earlier fix that let real replies run much longer (up to 2048 tokens
  // each) meant 3-4 of those long replies in the last 8 messages could alone approach/exceed
  // `numCtx` — but `trimToBudget` only ever dropped retrieved knowledge chunks, never history, so
  // an oversized prompt could still get sent to Ollama once every chunk was already gone.
  describe('multi-turn history growth (2026-08-04 fix)', () => {
    it('drops the OLDEST history turns (after every knowledge chunk is already gone) rather than refusing outright, once several long prior replies would otherwise exceed the budget', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
      // Simulate exactly the incident shape: several realistically-long prior assistant replies
      // (a "detailed contract summary"-sized reply, per the owner's own hypothesis) accumulated
      // across turns.
      const longReply = 'x'.repeat(4000); // ~1000 estimated tokens each
      const history = [
        { role: 'user' as const, content: 'question one' },
        { role: 'assistant' as const, content: longReply },
        { role: 'user' as const, content: 'question two' },
        { role: 'assistant' as const, content: longReply },
        { role: 'user' as const, content: 'question three' },
        { role: 'assistant' as const, content: longReply },
      ];
      const result = await buildChatMessages({
        history,
        chips: [],
        data: dataWith([]),
        // In-scope so the hard grounding gate allows assembly (off-topic "question four" would refuse).
        userMessage: 'What is NS04 prior approval — question four',
        // Small enough that 3 long replies + system prompt don't all fit, but NOT so small that
        // dropping history can't rescue it (unlike the numCtx:50 "refuse outright" case above) —
        // empirically (with the current system prompt — retuned 2026-08-04 for the groundedness /
        // NZ-scope / no-excerpts refuse instructions) leaves room for exactly the newest (turn-3)
        // pair once the older two are gone.
        numCtx: 5400,
      });
      expect(result.ungroundedRefuse).toBeUndefined();
      expect(result.contextTooLarge).toBeFalsy();
      expect(result.historyTrimmed).toBe(true);
      const contents = result.messages.map((m) => m.content);
      // The newest turn and the new user message must survive.
      expect(contents).toContain('question three');
      expect(contents).toContain('What is NS04 prior approval — question four');
      // At least the oldest turn must have been dropped to make room.
      expect(contents).not.toContain('question one');
    });

    it('still refuses outright (contextTooLarge) if dropping every chunk AND every history turn is not enough', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
      // Keep NS04 in the user message so the hard grounding gate allows the call — we are
      // specifically testing the context-budget safety net, not the ungrounded refuse path.
      const bloated = `NS04 ${'x'.repeat(400)}`;
      const result = await buildChatMessages({
        history: [
          { role: 'user', content: bloated },
          { role: 'assistant', content: bloated },
        ],
        chips: [],
        data: dataWith([]),
        userMessage: bloated,
        numCtx: 50,
      });
      expect(result.ungroundedRefuse).toBeUndefined();
      expect(result.contextTooLarge).toBe(true);
      expect(result.messages).toEqual([]);
    });

    it('does not report historyTrimmed when the conversation already fits without dropping anything', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
      const result = await buildChatMessages({
        history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
        chips: [],
        data: dataWith([]),
        userMessage: 'how are you',
      });
      expect(result.ungroundedRefuse).toBeUndefined();
      expect(result.historyTrimmed).toBeUndefined();
    });
  });

  describe('conversation summary injection (2026-08-04 smart summarization)', () => {
    it('injects the rolling summary into the system message and keeps recent turns verbatim', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
      const recent = [
        { role: 'user' as const, content: 'recent question' },
        { role: 'assistant' as const, content: 'recent answer' },
      ];
      const result = await buildChatMessages({
        history: recent,
        chips: [],
        data: dataWith([]),
        userMessage: 'What is NS04 follow up',
        conversationSummary: 'Facts established: NS01 package rates were confirmed.',
        historyAlreadyWindowed: true,
      });
      expect(result.ungroundedRefuse).toBeUndefined();
      expect(result.historySummarized).toBe(true);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toContain('Rolling prior-chat summary');
      expect(result.messages[0].content).toContain('NS01 package rates were confirmed');
      expect(result.messages.map((m) => m.content)).toContain('recent question');
      expect(result.messages.map((m) => m.content)).toContain('What is NS04 follow up');
      // Summary must NOT appear as a fake user/assistant transcript turn.
      expect(result.messages.filter((m) => m.role !== 'system').every((m) => !m.content.includes('NS01 package'))).toBe(
        true,
      );
    });

    it('does not claim historySummarized when no summary was provided', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
      const result = await buildChatMessages({
        history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
        chips: [],
        data: dataWith([]),
        userMessage: 'What is NS04 next',
      });
      expect(result.ungroundedRefuse).toBeUndefined();
      expect(result.historySummarized).toBeUndefined();
      // Injection header only — the static system prompt may mention the concept in quotes.
      expect(result.messages[0].content).not.toMatch(
        /\n\nRolling prior-chat summary \(older turns from THIS chat/,
      );
    });
  });
});

describe('context-chip re-injection (2026-08-04 investigation)', () => {
  beforeEach(() => {
    _resetKnowledgeCorpusCacheForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetKnowledgeCorpusCacheForTests();
  });

  // Confirms the investigated (and ruled out as a growth bug) behaviour: a chip's full content IS
  // re-sent in the system message on every turn — this is REQUIRED, not redundant, because the
  // system message itself is never persisted into `history` (only user/assistant text is), so
  // dropping it after turn 1 would make the model forget the attached record. This cost is
  // constant per request (one copy of each attached chip), not something that compounds as the
  // conversation grows — unlike history, it is not the source of the multi-turn timeout.
  it('re-sends the full chip content in the system message on every subsequent turn of the same conversation', async () => {
    const p = patient({ notes: 'Allergic to penicillin' });
    const data = dataWith([p]);
    const chip = makePatientChip(p);

    const turn1 = await buildChatMessages({ history: [], chips: [chip], data, userMessage: 'first question' });
    const turn2 = await buildChatMessages({
      history: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ],
      chips: [chip],
      data,
      userMessage: 'second question',
    });

    expect(turn1.messages[0].content).toContain('Allergic to penicillin');
    expect(turn2.messages[0].content).toContain('Allergic to penicillin');
  });

  it("does not accumulate multiple copies of the same chip's content within one turn's system message", async () => {
    const p = patient({ notes: 'Allergic to penicillin' });
    const data = dataWith([p]);
    const chip = makePatientChip(p);
    const result = await buildChatMessages({
      history: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ],
      chips: [chip],
      data,
      userMessage: 'second question',
    });
    const occurrences = result.messages[0].content.split('Allergic to penicillin').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('isConversationGettingLong (2026-08-04 "new chat" nudge)', () => {
  it('is false for a short conversation', async () => {
    const { isConversationGettingLong } = await import('./aiChatContext');
    expect(isConversationGettingLong(2)).toBe(false);
  });

  it('is true once the message count reaches the threshold', async () => {
    const { isConversationGettingLong, LONG_CONVERSATION_MESSAGE_THRESHOLD } = await import('./aiChatContext');
    expect(isConversationGettingLong(LONG_CONVERSATION_MESSAGE_THRESHOLD)).toBe(true);
    expect(isConversationGettingLong(LONG_CONVERSATION_MESSAGE_THRESHOLD - 1)).toBe(false);
  });
});

describe('buildChatMessages — real ACC document retrieval (RAG-lite)', () => {
  const SAMPLE_CORPUS = {
    generatedAt: '2026-08-04T00:00:00.000Z',
    chunks: [
      {
        id: 'nurse-og#0',
        sourceDocId: 'nurse-og',
        chunkIndex: 0,
        text: 'Extended Nursing (NS04) requires ACC prior approval once 25 in-person consultations have been completed or 105 days have passed.',
      },
      {
        id: 'elective-surgery-og#0',
        sourceDocId: 'elective-surgery-og',
        chunkIndex: 0,
        text: 'The Assessment Report and Treatment Plan (ARTP) process is required before most contracted elective surgery procedures proceed.',
      },
    ],
  };

  beforeEach(() => {
    _resetKnowledgeCorpusCacheForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_CORPUS }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetKnowledgeCorpusCacheForTests();
  });

  it('injects the relevant real document excerpt into the system message and returns it as a citation', async () => {
    const { messages, retrievedSources } = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'When does Extended Nursing NS04 need prior approval?',
    });
    expect(retrievedSources.length).toBeGreaterThan(0);
    expect(retrievedSources[0].sourceDocId).toBe('nurse-og');
    expect(retrievedSources[0].title).toContain('Nursing');
    expect(retrievedSources[0].url).toContain('acc.co.nz');
    expect(messages[0].content).toContain('Real ACC document excerpts');
    expect(messages[0].content).toContain('105 days');
    // 2026-08-04 "denied having document access despite real retrieved content" bug fix — the
    // per-turn knowledge block header itself must also assert the material is available now, not
    // just the static system prompt, since this is the text sitting immediately next to the
    // excerpt in the model's actual context for this exact request.
    expect(messages[0].content.toLowerCase()).toContain('available to you right now');
    expect(messages[0].content.toLowerCase()).toContain('do not say you lack access');
  });

  it('does not inject the elective-surgery excerpt for a nursing-specific question', async () => {
    const { retrievedSources } = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'When does Extended Nursing NS04 need prior approval?',
    });
    expect(retrievedSources.map((s) => s.sourceDocId)).not.toContain('elective-surgery-og');
  });

  it('hard-gates unrelated questions — empty messages, deterministic refuse, no Ollama payload', async () => {
    const { UNGROUNDED_REFUSE_MESSAGE } = await import('./aiChatContext');
    const result = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'what is the weather like today',
    });
    expect(result.retrievedSources).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(result.ungroundedRefuse).toBe(true);
    expect(result.ungroundedRefuseMessage).toBe(UNGROUNDED_REFUSE_MESSAGE);
  });

  // 2026-08-04 citation-integrity bug fix + hard-gate follow-up: a question that only
  // weakly/coincidentally overlaps retrievable chunks must retrieve NOTHING — and the hard
  // app-side gate must refuse before any model call (prompt-only refuse failed twice on
  // phi4-mini-reasoning). See knowledgeRetrieval.ts MIN_RELEVANT_SCORE, groundingGate.ts, and
  // docs/research/acc-public-contract-sources-2026-08.md §7.
  it('retrieves nothing and hard-gates a weakly/coincidentally overlapping emergency-transport question', async () => {
    const WEAK_OVERLAP_CORPUS = {
      generatedAt: '2026-08-04T00:00:00.000Z',
      chunks: [
        {
          id: 'nurse-og#0',
          sourceDocId: 'nurse-og',
          chunkIndex: 0,
          text:
            'Short Term Nursing Package is for clients who require in-person consultations for 13 or fewer ' +
            'calendar days and does not require prior ACC approval. Extended Nursing consultations are used ' +
            'once 25 in-person consultations have been completed or the client has received treatment for ' +
            'more than 105 days, and require prior ACC approval before invoicing under NS04.',
        },
        {
          id: 'elective-surgery-og#0',
          sourceDocId: 'elective-surgery-og',
          chunkIndex: 0,
          text:
            'The Assessment Report and Treatment Plan (ARTP) is the process by which a surgeon requests ' +
            'prior approval from ACC for a contracted elective surgery procedure. Non-Prior-Approval ' +
            'procedures listed in Appendix 4 do not require an ARTP submission before surgery proceeds.',
        },
        {
          id: 'allied-health-og#0',
          sourceDocId: 'allied-health-og',
          chunkIndex: 0,
          text:
            'Telehealth consultations for physiotherapy, hand therapy and podiatry must meet the ACC ' +
            'Telehealth Guide requirements, including client consent recorded in clinical notes and an ' +
            'initial risk assessment to ensure client safety before the telehealth consultation begins.',
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => WEAK_OVERLAP_CORPUS }));
    const { UNGROUNDED_REFUSE_MESSAGE } = await import('./aiChatContext');
    const result = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'What is the ambulance transport criteria for emergency clients requiring urgent care today?',
    });
    expect(result.retrievedSources).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(result.ungroundedRefuse).toBe(true);
    expect(result.ungroundedRefuseMessage).toBe(UNGROUNDED_REFUSE_MESSAGE);
    // Critical: Schedule 5.x / NS04 text must NOT be sitting in any model-bound payload.
    expect(JSON.stringify(result.messages)).not.toMatch(/Schedule 5\.11|25 consult|NS04/);
  });

  it('hard-gates "emergency transport criteria" on a fresh chat — no system prompt with static rules, no model call', async () => {
    const { UNGROUNDED_REFUSE_MESSAGE } = await import('./aiChatContext');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'can you pull up the emergency transport criteria',
    });
    expect(result.retrievedSources).toEqual([]);
    expect(result.historySummarized).toBeUndefined();
    expect(result.messages).toEqual([]);
    expect(result.ungroundedRefuse).toBe(true);
    expect(result.ungroundedRefuseMessage).toBe(UNGROUNDED_REFUSE_MESSAGE);
  });

  it('allows NS04 prior-approval questions and injects matching static rules (not the full rulebook dump on every turn)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { messages, ungroundedRefuse, retrievedSources } = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'When does Extended Nursing NS04 need prior approval?',
    });
    expect(ungroundedRefuse).toBeUndefined();
    expect(retrievedSources).toEqual([]);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toMatch(/NS04/i);
    expect(messages[0].content.toLowerCase()).toContain('reference material');
    // Off-topic predictive rule about NS06 near-50 should not be force-injected just because
    // we have a nursing question — only rules that scored as relevant.
    // (NS04-related rules may mention approval; the near-50-ns06 title should be absent.)
    expect(messages[0].content).not.toContain('Approaching the 50 NS06 cap');
  });
});
