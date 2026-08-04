import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetKnowledgeCorpusCacheForTests } from './knowledgeCorpus';
import {
  MIN_STATIC_RELEVANT_SCORE,
  UNGROUNDED_REFUSE_MESSAGE,
  buildRelevantStaticSections,
  evaluateChatGrounding,
  isCasualChatQuery,
  scoreStaticKnowledgeRelevance,
} from './groundingGate';

describe('isCasualChatQuery', () => {
  it('accepts simple greetings and thanks', () => {
    expect(isCasualChatQuery('hello')).toBe(true);
    expect(isCasualChatQuery('Hi!')).toBe(true);
    expect(isCasualChatQuery('thanks')).toBe(true);
    expect(isCasualChatQuery('Thank you.')).toBe(true);
  });

  it('rejects real questions', () => {
    expect(isCasualChatQuery('can you pull up the emergency transport criteria')).toBe(false);
    expect(isCasualChatQuery('NS04 prior approval')).toBe(false);
  });
});

describe('scoreStaticKnowledgeRelevance', () => {
  it(`scores NS04 / 25-consult questions above MIN_STATIC_RELEVANT_SCORE (${MIN_STATIC_RELEVANT_SCORE})`, () => {
    const ns04 = scoreStaticKnowledgeRelevance('When does Extended Nursing NS04 need prior approval?');
    expect(ns04.isRelevant).toBe(true);
    expect(ns04.maxScore).toBeGreaterThan(MIN_STATIC_RELEVANT_SCORE);
    expect(ns04.relevantRules.some((r) => /NS04/i.test(r.fact.title) || /NS04/i.test(r.fact.body))).toBe(
      true,
    );

    const cap = scoreStaticKnowledgeRelevance('what is the 25 consult package cap');
    expect(cap.isRelevant).toBe(true);
    expect(cap.maxScore).toBeGreaterThan(MIN_STATIC_RELEVANT_SCORE);
  });

  it('scores emergency transport / geneva / foreign flight questions as static-irrelevant (score 0) — transport is RAG-only, not Schedule 5.x', () => {
    // Static COMPLIANCE_RULES still must NOT light up for emergency transport (that was the
    // original confabulation path). After §6/§7 ingestion, emergency transport is answered via
    // RAG chunks, not static nursing rules — so static score stays 0 even though the topic is now
    // in the knowledge corpus.
    for (const q of [
      'can you pull up the emergency transport criteria',
      'geneva conventions',
      'flight air ambulance USA',
    ]) {
      const r = scoreStaticKnowledgeRelevance(q);
      expect(r.isRelevant).toBe(false);
      expect(r.maxScore).toBe(0);
      expect(r.relevantRules).toEqual([]);
    }
  });

  it('does not treat weak "review" overlap with NS05 annual review as static-relevant', () => {
    // "review rights" is a real RAG topic (ingested statutory docs) but must NOT pass the
    // static gate via incidental overlap with "NS05 annual review" — otherwise we'd inject
    // nursing-review rules for a different meaning of "review".
    const r = scoreStaticKnowledgeRelevance('review rights and appeal');
    expect(r.maxScore).toBeLessThanOrEqual(MIN_STATIC_RELEVANT_SCORE);
    expect(r.isRelevant).toBe(false);
  });
});

describe('buildRelevantStaticSections', () => {
  it('returns empty when nothing is relevant — never dumps the full rulebook', () => {
    const r = scoreStaticKnowledgeRelevance('geneva conventions');
    expect(buildRelevantStaticSections(r)).toEqual([]);
  });

  it('includes only matching rules (e.g. NS04) not the entire Schedule 5.x book', () => {
    const r = scoreStaticKnowledgeRelevance('NS04 prior approval');
    const sections = buildRelevantStaticSections(r).join('\n');
    expect(sections).toMatch(/NS04/i);
    expect(sections.toLowerCase()).toContain('reference material');
    // Unrelated predictive near-50-ns06 rule should not appear unless it also scored.
    const injectedTitles = r.relevantRules.map((x) => x.fact.title);
    expect(injectedTitles.some((t) => /NS04/i.test(t))).toBe(true);
  });
});

describe('evaluateChatGrounding (hard gate)', () => {
  beforeEach(() => {
    _resetKnowledgeCorpusCacheForTests();
    // Corpus unavailable → zero RAG chunks; gate must still work from static scoring alone.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetKnowledgeCorpusCacheForTests();
  });

  it('refuses genuinely off-topic questions (geneva / foreign flight) when corpus is unavailable — no model call path', async () => {
    // With fetch stubbed to fail, RAG returns nothing. Topics that are still absent from both
    // static KB and (in this stubbed path) RAG must refuse. Emergency transport is now ingested —
    // covered by the retrieved-chunks allow test below, not this refuse path.
    for (const q of ['geneva conventions', 'flight air ambulance USA']) {
      const d = await evaluateChatGrounding({ userMessage: q, hasChips: false });
      expect(d.allowModel).toBe(false);
      if (!d.allowModel) {
        expect(d.refuseMessage).toBe(UNGROUNDED_REFUSE_MESSAGE);
        expect(d.reason).toBe('no-retrieval-and-static-irrelevant');
        expect(d.staticSections).toEqual([]);
        expect(d.retrievedChunks).toEqual([]);
      }
    }
  });

  it('allows emergency transport criteria when RAG returns on-topic transport chunks (post §6/§7 ingest)', async () => {
    const transportChunk = {
      chunk: {
        id: 'accident-services-transport-accommodation#6',
        sourceDocId: 'accident-services-transport-accommodation',
        chunkIndex: 6,
        text:
          'Regulation 3 of the Ancillary Services Regulations 2002 states Emergency transport means transport that: ' +
          'starts within 24 hours of a claimant suffering a personal injury and is necessary for obtaining treatment urgently. ' +
          'ACC is responsible for emergency transport (air, and road including water) within 24 hours. ' +
          'All emergency transport, including emergency inter-hospital transfers, must be dispatched by an ambulance communications centre.',
      },
      score: 0.45,
    };
    const d = await evaluateChatGrounding({
      userMessage: 'can you pull up the emergency transport criteria',
      hasChips: false,
      retrievedChunks: [transportChunk],
    });
    expect(d.allowModel).toBe(true);
    if (d.allowModel) {
      expect(d.reason).toBe('retrieved-chunks');
      expect(d.retrievedChunks).toHaveLength(1);
      expect(d.retrievedChunks[0].chunk.sourceDocId).toBe('accident-services-transport-accommodation');
      // Must NOT inject static nursing Schedule 5.x / NS04 just because the model is allowed.
      expect(d.staticSections.join('\n')).not.toMatch(/NS04|Schedule 5\.11|25 consult/i);
    }
  });

  it('allows NS04 / 25-consult questions via static relevance and injects matching rules', async () => {
    const d = await evaluateChatGrounding({
      userMessage: 'When does Extended Nursing NS04 need prior approval?',
      hasChips: false,
    });
    expect(d.allowModel).toBe(true);
    if (d.allowModel) {
      expect(d.reason).toBe('static-relevant');
      expect(d.staticSections.length).toBeGreaterThan(0);
      expect(d.staticSections.join('\n')).toMatch(/NS04/i);
    }

    const cap = await evaluateChatGrounding({
      userMessage: 'what is the 25 consult package cap',
      hasChips: false,
    });
    expect(cap.allowModel).toBe(true);
    if (cap.allowModel) {
      expect(cap.reason).toBe('static-relevant');
      expect(cap.staticSections.join('\n')).toMatch(/25/);
    }
  });

  it('allows casual greetings without static KB or chunks', async () => {
    const d = await evaluateChatGrounding({ userMessage: 'hello', hasChips: false });
    expect(d.allowModel).toBe(true);
    if (d.allowModel) {
      expect(d.reason).toBe('casual');
      expect(d.staticSections).toEqual([]);
      expect(d.lexiconHits).toEqual([]);
    }
  });

  it('allows PHAS / district-nursing acronym questions via lexicon grounding (not hallucination path)', async () => {
    const d = await evaluateChatGrounding({
      userMessage: 'would district nursing services ever come under PHAS?',
      hasChips: false,
    });
    expect(d.allowModel).toBe(true);
    if (d.allowModel) {
      expect(d.reason).toBe('lexicon-relevant');
      expect(d.lexiconHits.some((h) => h.term === 'PHAS')).toBe(true);
      expect(d.staticSections.join('\n')).toMatch(/Public Health Acute Services/i);
      expect(d.staticSections.join('\n').toLowerCase()).toMatch(/not/);
      // Must not invent PHO mashups in the injected grounding text.
      expect(d.lexiconHits.find((h) => h.term === 'PHAS')!.expansion).not.toMatch(/Primary Health Organisation/i);
    }
  });

  it('allows chip-attached turns even when the question has no KB overlap', async () => {
    const d = await evaluateChatGrounding({
      userMessage: 'what is going on with this person',
      hasChips: true,
    });
    expect(d.allowModel).toBe(true);
    if (d.allowModel) {
      expect(d.reason).toBe('chip-context');
    }
  });

  it('allows the model when RAG returns chunks even if static KB is irrelevant', async () => {
    const fakeChunk = {
      chunk: {
        id: 'telehealth#0',
        sourceDocId: 'telehealth-guide',
        chunkIndex: 0,
        text: 'Telehealth consultations require client consent recorded in clinical notes.',
      },
      score: 0.5,
    };
    const d = await evaluateChatGrounding({
      userMessage: 'telehealth physiotherapy consent rules',
      hasChips: false,
      retrievedChunks: [fakeChunk],
    });
    expect(d.allowModel).toBe(true);
    if (d.allowModel) {
      expect(d.reason).toBe('retrieved-chunks');
      expect(d.retrievedChunks).toHaveLength(1);
    }
  });
});
