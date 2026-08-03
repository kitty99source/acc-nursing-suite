import { describe, expect, it } from 'vitest';
import { emptyData } from './sampleData';
import type { AppData, Claim, Contract, Patient } from '../types';
import {
  AI_ASSISTANT_SYSTEM_PROMPT,
  buildCaseStageSummary,
  buildChatPrompt,
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

describe('buildChatPrompt', () => {
  it('assembles system prompt + context + history + new message in order', () => {
    const p = patient();
    const data = dataWith([p]);
    const { prompt, contextBlock } = buildChatPrompt({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello, how can I help?' },
      ],
      chips: [makePatientChip(p)],
      data,
      userMessage: "What's the status of this patient's claim?",
    });

    expect(contextBlock).toContain('Jane Doe');
    const systemIdx = prompt.indexOf(AI_ASSISTANT_SYSTEM_PROMPT);
    const contextIdx = prompt.indexOf('Context used');
    const historyIdx = prompt.indexOf('Conversation so far');
    const userIdx = prompt.indexOf("User: What's the status");
    expect(systemIdx).toBe(0);
    expect(contextIdx).toBeGreaterThan(systemIdx);
    expect(historyIdx).toBeGreaterThan(contextIdx);
    expect(userIdx).toBeGreaterThan(historyIdx);
    expect(prompt.trim().endsWith('Assistant:')).toBe(true);
  });

  it('omits the Context used section entirely when there are no chips', () => {
    const { prompt, contextBlock } = buildChatPrompt({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'What is NS04?',
    });
    expect(contextBlock).toBe('');
    expect(prompt).not.toContain('Context used');
  });

  it('caps history to the most recent turns so the prompt stays bounded', () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content: `turn-${i}`,
    }));
    const { prompt } = buildChatPrompt({ history: longHistory, chips: [], data: dataWith([]), userMessage: 'latest' });
    expect(prompt).not.toContain('turn-0\n');
    expect(prompt).toContain('turn-19');
  });
});
