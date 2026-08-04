import { describe, expect, it } from 'vitest';
import { chunkDocumentText } from './knowledgeChunking';
import { buildCorpusIndex, NEAR_DUPLICATE_SIMILARITY_THRESHOLD, retrieveTopChunks, tokenize } from './knowledgeRetrieval';

describe('tokenize', () => {
  it('lowercases, strips punctuation and drops stopwords', () => {
    expect(tokenize('What is the Elective Surgery ARTP process?')).toEqual(['elective', 'surgery', 'artp', 'process']);
  });
});

describe('chunkDocumentText', () => {
  it('splits multiple paragraphs into a bounded number of chunks', () => {
    const paras = Array.from({ length: 6 }, (_, i) => `Paragraph number ${i} about nursing packages and consultations.`.repeat(3));
    const text = paras.join('\n\n');
    const chunks = chunkDocumentText('doc-a', text, { maxChars: 300, minChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.sourceDocId).toBe('doc-a');
      expect(c.id).toBe(`doc-a#${c.chunkIndex}`);
    }
  });

  it('merges very short trailing paragraphs into the previous chunk rather than leaving tiny orphans', () => {
    const text = 'A reasonably long first paragraph about elective surgery ARTP approvals and process.\n\nShort.';
    const chunks = chunkDocumentText('doc-b', text, { maxChars: 5000, minChars: 200 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('Short.');
  });

  it('strips page-break markers from our own PDF text extraction', () => {
    const text = 'First page content here.\n\n--- PAGE 2 ---\n\nSecond page content here about telehealth rules.';
    const chunks = chunkDocumentText('doc-c', text, { maxChars: 5000, minChars: 10 });
    const joined = chunks.map((c) => c.text).join(' ');
    expect(joined).not.toContain('PAGE');
    expect(joined).toContain('telehealth');
  });
});

describe('retrieveTopChunks (RAG-lite relevance scoring)', () => {
  const nursingChunk = chunkDocumentText('nurse-og', [
    'Short Term Nursing Package is for clients who require in-person consultations for 13 or fewer',
    'calendar days and does not require prior ACC approval. Extended Nursing consultations are used',
    'once 25 in-person consultations have been completed or the client has received treatment for',
    'more than 105 days, and require prior ACC approval before invoicing under NS04.',
  ].join(' '))[0];

  const electiveSurgeryChunk = chunkDocumentText('elective-surgery-og', [
    'The Assessment Report and Treatment Plan (ARTP) is the process by which a surgeon requests',
    'prior approval from ACC for a contracted elective surgery procedure. Non-Prior-Approval',
    'procedures listed in Appendix 4 do not require an ARTP submission before surgery proceeds.',
  ].join(' '))[0];

  const alliedHealthChunk = chunkDocumentText('allied-health-og', [
    'Telehealth consultations for physiotherapy, hand therapy and podiatry must meet the ACC',
    'Telehealth Guide requirements, including client consent recorded in clinical notes and an',
    'initial risk assessment to ensure client safety before the telehealth consultation begins.',
  ].join(' '))[0];

  const termsChunk = chunkDocumentText('health-contract-terms-conditions', [
    'The Supplier must not transmit, transfer, export or store Personal Information and',
    'Confidential Information outside of New Zealand and/or Australia, in accordance with the',
    'Standard Terms and Conditions clause 9 information security obligations.',
  ].join(' '))[0];

  const allChunks = [nursingChunk, electiveSurgeryChunk, alliedHealthChunk, termsChunk];
  const index = buildCorpusIndex(allChunks);

  it('retrieves the elective surgery chunk for an ARTP/elective-surgery question, not the nursing chunk', () => {
    const results = retrieveTopChunks('What is the ARTP process for elective surgery prior approval?', allChunks, index);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.sourceDocId).toBe('elective-surgery-og');
    expect(results.map((r) => r.chunk.sourceDocId)).not.toContain('nursing-og-should-not-match');
  });

  it('retrieves the allied health/telehealth chunk for a telehealth physiotherapy question', () => {
    const results = retrieveTopChunks('Can physiotherapy be delivered by telehealth?', allChunks, index);
    expect(results[0].chunk.sourceDocId).toBe('allied-health-og');
  });

  it('retrieves the nursing chunk for a nursing package question', () => {
    const results = retrieveTopChunks('How many consultations before Extended Nursing NS04 applies?', allChunks, index);
    expect(results[0].chunk.sourceDocId).toBe('nurse-og');
  });

  it('retrieves the terms and conditions chunk for a data-storage/information-security question', () => {
    const results = retrieveTopChunks('Can client information be stored outside New Zealand?', allChunks, index);
    expect(results[0].chunk.sourceDocId).toBe('health-contract-terms-conditions');
  });

  it('returns nothing for a query with no real overlap with the corpus', () => {
    const results = retrieveTopChunks('what is the weather forecast for tomorrow', allChunks, index);
    expect(results).toHaveLength(0);
  });

  // 2026-08-04 citation-integrity bug fix: the real owner-reported incident asked about
  // ambulance/emergency-transport criteria — a topic genuinely absent from this corpus. The old
  // `minScore` default of `0` only excluded ZERO-overlap chunks; a query sharing just a couple of
  // incidental common words (e.g. "criteria", "emergency", "approval") with an unrelated chunk
  // still scored weakly above zero and got retrieved/cited as if it were real support. This query
  // scores <=0.06 against every chunk here (verified empirically) — well below MIN_RELEVANT_SCORE
  // (0.21) — and must now retrieve NOTHING, not the single weakest-matching chunk.
  it('returns nothing for a query that only weakly/coincidentally overlaps the corpus, not a real topic match (MIN_RELEVANT_SCORE)', () => {
    const results = retrieveTopChunks(
      'What is the ambulance transport criteria for emergency clients requiring urgent care today?',
      allChunks,
      index,
    );
    expect(results).toHaveLength(0);
  });

  it('respects the k limit', () => {
    const results = retrieveTopChunks('ACC Supplier client', allChunks, index, { k: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('excludes a table-of-contents-shaped chunk even when it would otherwise score well (2026-08-04 context-overflow fix)', () => {
    // Built directly (not via chunkDocumentText) since knowledgeChunking.ts now excludes
    // ToC-shaped chunks at ingestion time too — this test exercises retrieveTopChunks's own
    // defense-in-depth filter for a corpus/chunk source built before that ingestion-time fix.
    const tocChunk = {
      id: 'elective-surgery-og#toc',
      sourceDocId: 'elective-surgery-og',
      chunkIndex: 999,
      text:
        'Table of Contents Useful Contact Information ' +
        '........................................................................................... 1 ' +
        'Useful Links .................................................................................................................. 2 ' +
        '1. Introduction ........................................................................................... 4 ' +
        '2. Who can hold this Contract? ................................................................................... 4 ' +
        '3. What does the contract cover? ............................................................................... 5',
    };
    const chunksWithToc = [...allChunks, tocChunk];
    const indexWithToc = buildCorpusIndex(chunksWithToc);
    const results = retrieveTopChunks('What is the ARTP process for elective surgery prior approval?', chunksWithToc, indexWithToc);
    expect(results.map((r) => r.chunk.id)).not.toContain(tocChunk.id);
  });

  // 2026-08-04 follow-up fix: a second consecutive owner timeout report showed the top-3 results
  // for one question could include 2-3 near-identical/overlapping chunks from the SAME source
  // document — wasteful even though (per the investigation) it was not the actual cause of that
  // specific timeout. Guard against genuinely redundant content crowding out a diverse top-k.
  describe('near-duplicate chunk dedup', () => {
    const baseText =
      'The Supplier must not transmit, transfer, export or store Personal Information and ' +
      'Confidential Information outside of New Zealand and/or Australia, in accordance with the ' +
      'Standard Terms and Conditions clause 9 information security obligations for this contract.';

    const nearDuplicateChunk = {
      id: 'health-contract-terms-conditions#1',
      sourceDocId: 'health-contract-terms-conditions',
      chunkIndex: 1,
      // Same substantive content, reworded/reordered slightly — a real near-duplicate, not an
      // exact string match, since retrieval chunking rarely produces byte-identical chunks.
      text:
        'The Supplier must not transfer, transmit, export or store Confidential Information and ' +
        'Personal Information outside of New Zealand or Australia, per Standard Terms and Conditions ' +
        'clause 9 information security obligations under this contract.',
    };

    const genuinelyDifferentChunk = {
      id: 'health-contract-terms-conditions#2',
      sourceDocId: 'health-contract-terms-conditions',
      chunkIndex: 2,
      text:
        'Either party may terminate this Contract for services by giving 90 days written notice to ' +
        'the other party, without needing to show cause, subject to the transition obligations in ' +
        'clause 14 regarding client handover and outstanding invoices.',
    };

    it('skips a near-duplicate candidate chunk from the same source document, keeping a genuinely different one instead', () => {
      const chunksWithDup = [...allChunks, nearDuplicateChunk, genuinelyDifferentChunk];
      const dupIndex = buildCorpusIndex(chunksWithDup);
      // minScore: 0 isolates the dedup mechanic under test from the separate 2026-08-04
      // citation-integrity relevance-threshold fix (MIN_RELEVANT_SCORE) — this tiny synthetic
      // fixture's "genuinely different" chunk scores far lower than a real corpus's typical
      // on-topic chunk simply because there are only 2 chunks to compute IDF against, not because
      // it's actually irrelevant.
      const results = retrieveTopChunks(
        'Can client information be stored outside New Zealand under the Standard Terms and Conditions?',
        chunksWithDup,
        dupIndex,
        { k: 3, minScore: 0 },
      );
      const ids = results.map((r) => r.chunk.id);
      // The two near-duplicate chunks about the SAME clause should never both appear.
      const bothTermsVariants = ids.includes(termsChunk.id) && ids.includes(nearDuplicateChunk.id);
      expect(bothTermsVariants).toBe(false);
      // The dropped "slot" should go to a genuinely different chunk, not just fewer total results.
      expect(ids).toContain(genuinelyDifferentChunk.id);
    });

    it('does not dedup two chunks from the same document that are only topically related, not near-identical', () => {
      // health-contract-terms-conditions' own real termsChunk vs. the unrelated-content
      // genuinelyDifferentChunk (different clause entirely) must both be retrievable together.
      const chunksWithBoth = [termsChunk, genuinelyDifferentChunk];
      const idx = buildCorpusIndex(chunksWithBoth);
      // minScore: 0 — same isolation rationale as the test above.
      const results = retrieveTopChunks('Standard Terms and Conditions contract clauses', chunksWithBoth, idx, {
        k: 2,
        minScore: 0,
      });
      expect(results.length).toBe(2);
    });

    it('the near-duplicate fixture pair really is above the similarity threshold (sanity check the fixture, not just the behaviour)', () => {
      const a = new Set(tokenize(baseText));
      const b = new Set(tokenize(nearDuplicateChunk.text));
      const intersection = [...a].filter((t) => b.has(t)).length;
      const union = new Set([...a, ...b]).size;
      const jaccard = intersection / union;
      expect(jaccard).toBeGreaterThan(NEAR_DUPLICATE_SIMILARITY_THRESHOLD);
    });
  });
});
