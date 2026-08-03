import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { emptyData } from '../lib/sampleData';

// Contract CRUD (2026-08-04): a real, first-class record type for provider/employer/payer
// contracts — rate table, effective dates, service codes covered. See types/index.ts `Contract`
// and docs/research/ai-chat-assistant-2026-08.md for the "why this shape" writeup. Synthetic
// fixtures only.

function seed() {
  useStore.setState({ ready: true, data: { ...emptyData() } });
}

describe('Contract CRUD', () => {
  beforeEach(() => {
    seed();
  });

  it('starts with no contracts when the field is entirely absent (optional/additive schema field)', () => {
    expect(useStore.getState().data.contracts ?? []).toEqual([]);
  });

  it('adds a contract and returns its id', () => {
    const id = useStore.getState().addContract({
      providerName: 'SAMPLE — Wellnz Limited',
      customerNumber: '1216',
      claimsEmail: '',
      effectiveFrom: '2026-01-01',
      effectiveTo: '',
      serviceCodesCovered: ['NS04', 'NS05'],
      rateTable: [{ serviceCode: 'NS04', rate: 85.5 }],
      notes: 'Synthetic test fixture.',
    });
    expect(id).toBeTruthy();
    const contracts = useStore.getState().data.contracts ?? [];
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({ id, providerName: 'SAMPLE — Wellnz Limited', customerNumber: '1216' });
  });

  it('updates a contract in place by id', () => {
    const id = useStore.getState().addContract({
      providerName: 'SAMPLE — Old Name',
      effectiveFrom: '2026-01-01',
      serviceCodesCovered: [],
      rateTable: [],
      notes: '',
    });
    useStore.getState().updateContract(id, { providerName: 'SAMPLE — New Name' });
    const contracts = useStore.getState().data.contracts ?? [];
    expect(contracts.find((c) => c.id === id)?.providerName).toBe('SAMPLE — New Name');
  });

  it('removes a contract by id', () => {
    const id = useStore.getState().addContract({
      providerName: 'SAMPLE — To Delete',
      effectiveFrom: '2026-01-01',
      serviceCodesCovered: [],
      rateTable: [],
      notes: '',
    });
    useStore.getState().removeContract(id);
    expect(useStore.getState().data.contracts ?? []).toEqual([]);
  });

  it('does not throw when removing/updating on a fresh dataset with no contracts array at all', () => {
    expect(() => useStore.getState().updateContract('missing', { providerName: 'x' })).not.toThrow();
    expect(() => useStore.getState().removeContract('missing')).not.toThrow();
  });
});
