import { describe, expect, it } from 'vitest';
import { emptyData } from './sampleData';
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
  it('assembles a structured messages array: one leading system message (with context folded in), then real history turns, then the new user message', () => {
    const p = patient();
    const data = dataWith([p]);
    const { messages, contextBlock } = buildChatMessages({
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

  it('omits the "Context used" text entirely when there are no chips', () => {
    const { messages, contextBlock } = buildChatMessages({
      history: [],
      chips: [],
      data: dataWith([]),
      userMessage: 'What is NS04?',
    });
    expect(contextBlock).toBe('');
    expect(messages[0].content).not.toContain('Context used');
    expect(messages).toEqual([
      { role: 'system', content: AI_ASSISTANT_SYSTEM_PROMPT },
      { role: 'user', content: 'What is NS04?' },
    ]);
  });

  it('caps history to the most recent turns so the messages array stays bounded', () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content: `turn-${i}`,
    }));
    const { messages } = buildChatMessages({ history: longHistory, chips: [], data: dataWith([]), userMessage: 'latest' });
    const contents = messages.map((m) => m.content);
    expect(contents).not.toContain('turn-0');
    expect(contents).toContain('turn-19');
    // system + 8 history turns + new user message
    expect(messages).toHaveLength(1 + 8 + 1);
  });
});
