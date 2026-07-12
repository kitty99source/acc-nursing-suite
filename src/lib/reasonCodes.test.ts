import { describe, it, expect } from 'vitest';
import { parseReason, lookupReasonCode } from './reasonCodes';

describe('parseReason', () => {
  it('extracts a documented ACC reason code as a whole token', () => {
    expect(parseReason('NAF - not an ACC claim').reasonCode).toBe('NAF');
    expect(parseReason('RATE mismatch, re-invoice').reasonCode).toBe('RATE');
    expect(parseReason('12M older than 12 months').reasonCode).toBe('12M');
  });

  it('keeps the full reason text alongside the code', () => {
    const r = parseReason('AP prior approval needed');
    expect(r.reasonCode).toBe('AP');
    expect(r.reasonText).toBe('AP prior approval needed');
  });

  it('returns just the text (no code) for free-text with no known code', () => {
    const r = parseReason('please phone the office about this one');
    expect(r.reasonCode).toBeUndefined();
    expect(r.reasonText).toBe('please phone the office about this one');
  });

  it('returns an empty object for blank input', () => {
    expect(parseReason('')).toEqual({});
    expect(parseReason(undefined)).toEqual({});
  });
});

describe('lookupReasonCode', () => {
  it('is case-insensitive and returns rich info for known codes', () => {
    const info = lookupReasonCode('naf');
    expect(info?.code).toBe('NAF');
    expect(info?.label).toBeTruthy();
    expect(info?.action).toBeTruthy();
  });

  it('returns undefined for unknown/blank codes', () => {
    expect(lookupReasonCode('ZZZ')).toBeUndefined();
    expect(lookupReasonCode(undefined)).toBeUndefined();
  });
});
