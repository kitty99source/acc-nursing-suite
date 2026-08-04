import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAccScheduleDataCacheForTests, loadAccScheduleData } from './scheduleData';

const SAMPLE_FILE = {
  generatedAt: '2026-08-04T00:00:00.000Z',
  schedules: [
    { sourceDocId: 'nursing-service-schedule', items: [{ code: 'NS01', description: 'Short Term Nursing Package', price: 525.4, actualCost: false, costCapPrice: null, pricingUnit: 'Package Price' }] },
  ],
};

beforeEach(() => {
  _resetAccScheduleDataCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetAccScheduleDataCacheForTests();
});

describe('loadAccScheduleData', () => {
  it('fetches and caches the generated schedule data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_FILE });
    vi.stubGlobal('fetch', fetchMock);
    const a = await loadAccScheduleData();
    const b = await loadAccScheduleData();
    expect(a).toHaveLength(1);
    expect(a[0].sourceDocId).toBe('nursing-service-schedule');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/acc/schedules.json');
  });

  it('returns an empty array (never throws) when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await loadAccScheduleData();
    expect(result).toEqual([]);
  });
});
