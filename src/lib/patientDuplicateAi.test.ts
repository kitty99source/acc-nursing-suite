import { describe, expect, it, vi } from 'vitest';
import {
  buildFuzzyDuplicateCandidates,
  runAiDuplicatePatientCheck,
} from './patientDuplicateAi';
import type { FetchLike } from './aiService';
import type { Patient } from '../types';

function patient(partial: Partial<Patient> & Pick<Patient, 'id' | 'name'>): Patient {
  return { nhi: '', dob: '', notes: '', ...partial };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('buildFuzzyDuplicateCandidates', () => {
  it('flags a same-DOB, one-character-typo name pair the exact-match rule would miss', () => {
    const a = patient({ id: 'p1', name: 'SAMPLE — Aroha Brown', dob: '1958-04-12' });
    const b = patient({ id: 'p2', name: 'SAMPLE — Arohaa Brown', dob: '1958-04-12' });
    const candidates = buildFuzzyDuplicateCandidates([a, b]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].heuristic).toMatch(/typo|OCR/i);
  });

  it('flags a nickname/full-name variant sharing a first name token and DOB', () => {
    const a = patient({ id: 'p1', name: 'John Smith', dob: '1971-11-02' });
    const b = patient({ id: 'p2', name: 'John Smithson', dob: '1971-11-02' });
    const candidates = buildFuzzyDuplicateCandidates([a, b]);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('flags a transposed day/month DOB digit pair with the same name', () => {
    const a = patient({ id: 'p1', name: 'Mere Tane', dob: '1949-07-21' });
    const b = patient({ id: 'p2', name: 'Mere Tane', dob: '1949-07-12' });
    const candidates = buildFuzzyDuplicateCandidates([a, b]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].heuristic).toMatch(/transposed/i);
  });

  it('does NOT flag a coincidentally similar name with a clearly different DOB', () => {
    const a = patient({ id: 'p1', name: 'John Smith', dob: '1971-11-02' });
    const b = patient({ id: 'p2', name: 'Jane Smith', dob: '1990-06-15' });
    const candidates = buildFuzzyDuplicateCandidates([a, b]);
    expect(candidates).toHaveLength(0);
  });

  it('excludes pairs already caught by the exact NHI match', () => {
    const a = patient({ id: 'p1', name: 'John Smith', nhi: 'ABC1234', dob: '1971-11-02' });
    const b = patient({ id: 'p2', name: 'John Smith', nhi: 'ABC1234', dob: '1971-11-02' });
    expect(buildFuzzyDuplicateCandidates([a, b])).toHaveLength(0);
  });

  it('excludes pairs already caught by the exact name+DOB match', () => {
    const a = patient({ id: 'p1', name: 'John Smith', dob: '1971-11-02' });
    const b = patient({ id: 'p2', name: 'John Smith', dob: '1971-11-02' });
    expect(buildFuzzyDuplicateCandidates([a, b])).toHaveLength(0);
  });

  it('never flags two people with distinct real NHIs, however similar the names', () => {
    const a = patient({ id: 'p1', name: 'John Smith', nhi: 'ABC1234', dob: '1971-11-02' });
    const b = patient({ id: 'p2', name: 'Jon Smith', nhi: 'XYZ9999', dob: '1971-11-02' });
    expect(buildFuzzyDuplicateCandidates([a, b])).toHaveLength(0);
  });

  it('caps the number of candidate pairs sent to the model', () => {
    const many: Patient[] = [];
    for (let i = 0; i < 30; i++) {
      many.push(patient({ id: `a${i}`, name: `Sameish Name${i}`, dob: '1980-01-01' }));
      many.push(patient({ id: `b${i}`, name: `Sameish Namee${i}`, dob: '1980-01-01' }));
    }
    const candidates = buildFuzzyDuplicateCandidates(many, { maxPairs: 5 });
    expect(candidates.length).toBeLessThanOrEqual(5);
  });
});

describe('runAiDuplicatePatientCheck', () => {
  const aroha = patient({ id: 'p1', name: 'SAMPLE — Aroha Brown', dob: '1958-04-12' });
  const arohaTypo = patient({ id: 'p2', name: 'SAMPLE — Arohaa Brown', dob: '1958-04-12' });

  it('short-circuits with status "disabled" and makes no network call when the feature is off', async () => {
    const fetchImpl = vi.fn();
    const result = await runAiDuplicatePatientCheck([aroha, arohaTypo], {
      enabled: false,
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.status).toBe('disabled');
    expect(result.suggestions).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns "no-candidates" without a network call when nothing fuzzy-matches', async () => {
    const distinct = patient({ id: 'p3', name: 'Someone Else Entirely', dob: '2000-01-01' });
    const fetchImpl = vi.fn();
    const result = await runAiDuplicatePatientCheck([distinct], {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.status).toBe('no-candidates');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns "unavailable" (not a thrown error) when the local service is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await runAiDuplicatePatientCheck([aroha, arohaTypo], {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.status).toBe('unavailable');
    expect(result.suggestions).toEqual([]);
  });

  it('parses a valid model answer into a structured suggestion referencing real patient ids', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        response: '[{"pair": "P0", "reason": "Same DOB, name differs by one letter (OCR-plausible).", "confidence": "high"}]',
      }),
    );
    const result = await runAiDuplicatePatientCheck([aroha, arohaTypo], {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.status).toBe('ok');
    expect(result.suggestions).toEqual([
      {
        patientAId: 'p1',
        patientBId: 'p2',
        reason: 'Same DOB, name differs by one letter (OCR-plausible).',
        confidence: 'high',
      },
    ]);
  });

  it('returns an empty ok result when the model explicitly says no duplicates', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: '[]' }));
    const result = await runAiDuplicatePatientCheck([aroha, arohaTypo], {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.status).toBe('ok');
    expect(result.suggestions).toEqual([]);
  });

  it('returns "unparseable" (not a crash) when the model ignores the JSON-only instruction', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ response: "I think these might be the same person but I'm not totally sure why." }),
    );
    const result = await runAiDuplicatePatientCheck([aroha, arohaTypo], {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.status).toBe('unparseable');
  });

  it('ignores a hallucinated pair reference that does not exist in the candidate list', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ response: '[{"pair": "P99", "reason": "made up", "confidence": "high"}]' }),
    );
    const result = await runAiDuplicatePatientCheck([aroha, arohaTypo], {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.status).toBe('ok');
    expect(result.suggestions).toEqual([]);
  });
});
