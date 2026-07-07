import { describe, it, expect } from 'vitest';
import { resolveWorkingCopyLoad } from './recovery';
import { serialize } from './storage';
import { emptyData } from './sampleData';

describe('resolveWorkingCopyLoad', () => {
  it('returns empty when no working copy', async () => {
    expect(await resolveWorkingCopyLoad(undefined)).toEqual({ type: 'empty' });
  });

  it('returns corrupt for invalid JSON — never silent sample fallback', async () => {
    const result = await resolveWorkingCopyLoad('{not valid json');
    expect(result.type).toBe('corrupt');
    if (result.type === 'corrupt') {
      expect(result.error).toBeTruthy();
    }
  });

  it('returns ok with warnings for valid data', async () => {
    const data = emptyData();
    data.claims = [
      {
        id: 'c1',
        patientId: 'ghost',
        claimNumber: '1',
        acc45Number: '',
        poNumber: '',
        injuryDescription: '',
        type: 'original',
        status: 'active',
        day1Date: '2024-01-01',
      },
    ];
    const text = await serialize(data);
    const result = await resolveWorkingCopyLoad(text);
    expect(result.type).toBe('ok');
    if (result.type === 'ok') {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});
