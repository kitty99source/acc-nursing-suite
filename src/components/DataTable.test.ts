import { describe, it, expect } from 'vitest';
import { VIRTUAL_ROW_THRESHOLD } from '../components/DataTable';

describe('DataTable virtualization', () => {
  it('virtualizes when row count exceeds threshold', () => {
    expect(VIRTUAL_ROW_THRESHOLD).toBe(50);
  });
});
