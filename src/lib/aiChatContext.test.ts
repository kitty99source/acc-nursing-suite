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
    expect(AI_ASSISTANT_SYSTEM_PROMPT).toContain(summary);
  });

  it('lists the real case-workflow stages in order', () => {
    const stages = buildCaseStageSummary();
    expect(stages).toContain('Not started');
    expect(stages).toContain('Closed');
    expect(AI_ASSISTANT_SYSTEM_PROMPT).toContain(stages);
  });

  it('states it runs locally and never invents ACC policy', () => {
    expect(AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase()).toContain('locally');
    expect(AI_ASSISTANT_SYSTEM_PROMPT.toLowerCase()).toContain('do not invent');
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
    expect(messages[0].content).not.toContain('Context used');
    expect(messages).toEqual([
      { role: 'system', content: AI_ASSISTANT_SYSTEM_PROMPT },
      { role: 'user', content: 'What is NS04?' },
    ]);
  });

  it('caps history to the most recent turns so the messages array stays bounded', async () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content: `turn-${i}`,
    }));
    const { messages } = await buildChatMessages({ history: longHistory, chips: [], data: dataWith([]), userMessage: 'latest' });
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

  const SAMPLE_CORPUS = {
    generatedAt: '2026-08-04T00:00:00.000Z',
    chunks: [
      {
        id: 'nurse-og#0',
        sourceDocId: 'nurse-og',
        chunkIndex: 0,
        text: 'Extended Nursing (NS04) requires ACC prior approval once 25 consultations have been completed or 105 days have passed for elective surgery ARTP contract questions.',
      },
      {
        id: 'elective-surgery-og#0',
        sourceDocId: 'elective-surgery-og',
        chunkIndex: 0,
        text: 'The Assessment Report and Treatment Plan (ARTP) process is required before most contracted elective surgery procedures proceed under this contract.',
      },
      {
        id: 'health-contract-terms-conditions#0',
        sourceDocId: 'health-contract-terms-conditions',
        chunkIndex: 0,
        text: 'The Supplier must not transmit Personal Information outside New Zealand under this elective surgery contract, per clause 9 of the Standard Terms and Conditions.',
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
      // A small numCtx forces trimming with this small sample corpus, deterministically, without
      // needing a giant real-world fixture (empirically: all 3 sample chunks fit at numCtx >=
      // ~2200, exactly 2 fit at 2100, exactly 1 — the most relevant — fits at 2000).
      numCtx: 2100,
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
      // Same numCtx that forces chunk-dropping in the test above — confirms history/user survive
      // the SAME trim pass that drops knowledge chunks, not just an untrimmed happy path.
      numCtx: 2100,
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
        userMessage: 'question four',
        // Small enough that 3 long replies + system prompt don't all fit, but NOT so small that
        // dropping history can't rescue it (unlike the numCtx:50 "refuse outright" case above) —
        // empirically leaves room for exactly the newest (turn-3) pair once the older two are gone.
        numCtx: 3400,
      });
      expect(result.contextTooLarge).toBeFalsy();
      expect(result.historyTrimmed).toBe(true);
      const contents = result.messages.map((m) => m.content);
      // The newest turn and the new user message must survive.
      expect(contents).toContain('question three');
      expect(contents).toContain('question four');
      // At least the oldest turn must have been dropped to make room.
      expect(contents).not.toContain('question one');
    });

    it('still refuses outright (contextTooLarge) if dropping every chunk AND every history turn is not enough', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
      const result = await buildChatMessages({
        history: [
          { role: 'user', content: 'x'.repeat(400) },
          { role: 'assistant', content: 'x'.repeat(400) },
        ],
        chips: [],
        data: dataWith([]),
        userMessage: 'x'.repeat(400),
        numCtx: 50,
      });
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
      expect(result.historyTrimmed).toBeUndefined();
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

  it('retrieves nothing for an unrelated question — never forces irrelevant content into the prompt', async () => {
    const { retrievedSources, messages } = await buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'what is the weather like today',
    });
    expect(retrievedSources).toEqual([]);
    expect(messages[0].content).not.toContain('Real ACC document excerpts');
  });
});
