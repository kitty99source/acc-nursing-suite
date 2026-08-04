import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';

import { Contracts } from './Contracts';
import { useStore } from '../state/store';
import { emptyData } from '../lib/sampleData';
import { NATIONAL_SCHEDULE_MARKER_KEY } from '../lib/acc/nationalContracts';

vi.mock('../lib/auditLog', () => ({
  appendAudit: vi.fn(async () => {}),
}));

const SAMPLE_SCHEDULES_FILE = {
  generatedAt: '2026-08-04T00:00:00.000Z',
  schedules: [
    {
      sourceDocId: 'nursing-service-schedule',
      items: [
        { code: 'NS01', description: 'Short Term Nursing Package', price: 525.4, actualCost: false, costCapPrice: null, pricingUnit: 'Package Price' },
        { code: 'NS10', description: 'Medical Consumables', price: null, actualCost: true, costCapPrice: null, pricingUnit: '' },
      ],
    },
    {
      sourceDocId: 'ACC1523-Specified-treatment-provider-costs',
      items: [{ code: 'ACU1', description: 'Acupuncture', flatExclGst: 27.42, flatInclGst: 31.53, hourlyExclGst: 68.99, hourlyInclGst: 79.34 }],
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.setState({ data: { ...emptyData(), contracts: [] } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_SCHEDULES_FILE }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickButtonByText(text: string) {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  expect(btn).toBeTruthy();
  act(() => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('<Contracts /> — ACC national schedule seeding', () => {
  it('adds real, clearly-labelled national schedule Contract records when clicked, from the fetched asset', async () => {
    act(() => {
      root.render(<Contracts />);
    });

    clickButtonByText('Add ACC national schedules');
    await flush();

    const contracts = useStore.getState().data.contracts ?? [];
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts.some((c) => c.providerName.includes('Nursing'))).toBe(true);
    expect(contracts.some((c) => c.notes.includes('ACC NATIONAL PUBLISHED SCHEDULE'))).toBe(true);
    const nursing = contracts.find((c) => c.providerName.includes('Nursing'))!;
    expect(nursing.rateTable.find((r) => r.serviceCode === 'NS01')?.rate).toBe(525.4);
    expect(nursing.customFields?.[NATIONAL_SCHEDULE_MARKER_KEY]).toBe('nursing-service-schedule');
  });

  it('is idempotent — clicking a second time does not duplicate already-seeded schedules', async () => {
    act(() => {
      root.render(<Contracts />);
    });

    clickButtonByText('Add ACC national schedules');
    await flush();
    const firstCount = (useStore.getState().data.contracts ?? []).length;

    act(() => {
      root.render(<Contracts />);
    });
    clickButtonByText('Add ACC national schedules');
    await flush();
    const secondCount = (useStore.getState().data.contracts ?? []).length;
    expect(secondCount).toBe(firstCount);
  });
});
