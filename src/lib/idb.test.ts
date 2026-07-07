import { describe, it, expect, vi } from 'vitest';
import { isRetryableIdbError, withIdbRetry } from './idb';

describe('IDB retry (P3-007)', () => {
  it('identifies transient IDB error names', () => {
    expect(isRetryableIdbError({ name: 'AbortError' })).toBe(true);
    expect(isRetryableIdbError({ name: 'TransactionInactiveError' })).toBe(true);
    expect(isRetryableIdbError({ name: 'QuotaExceededError' })).toBe(false);
  });

  it('retries retryable errors then succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const promise = withIdbRetry(async () => {
      calls++;
      if (calls < 2) {
        const err = new DOMException('aborted', 'AbortError');
        throw err;
      }
      return 'ok';
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withIdbRetry(async () => {
        calls++;
        throw new DOMException('full', 'QuotaExceededError');
      }),
    ).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(calls).toBe(1);
  });
});
