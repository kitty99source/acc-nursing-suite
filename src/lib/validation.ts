// ============================================================================
// Local format validation for patient identifiers (P6-007).
// Warnings only — does not block saves unless the UI chooses to surface them.
// ============================================================================

const NHI_LETTER_VALUES: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 9,
  K: 10,
  L: 11,
  M: 12,
  N: 13,
  P: 14,
  Q: 15,
  R: 16,
  S: 17,
  T: 18,
  U: 19,
  V: 20,
  W: 21,
  X: 22,
  Y: 23,
  Z: 24,
};

export function normalizeNhi(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function normalizeClaimNumber(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, '').trim();
}

export interface NhiValidation {
  ok: boolean;
  normalized: string;
  warning?: string;
}

/** NZ NHI mod-11 check (Schedule format: 3 letters + 4 digits, no I/O in letters). */
export function validateNhi(raw?: string): NhiValidation {
  const normalized = normalizeNhi(raw);
  if (!normalized) return { ok: true, normalized: '' };
  if (!/^[A-Z]{3}\d{4}$/.test(normalized)) {
    return {
      ok: false,
      normalized,
      warning: 'NHI should be 3 letters and 4 digits (e.g. ABC1234).',
    };
  }
  if (/[IO]/.test(normalized.slice(0, 3))) {
    return { ok: false, normalized, warning: 'NHI letters cannot include I or O.' };
  }
  const weights = [7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const ch = normalized[i];
    const val = i < 3 ? NHI_LETTER_VALUES[ch] : Number(ch);
    if (val == null || Number.isNaN(val)) {
      return { ok: false, normalized, warning: 'NHI contains an invalid character.' };
    }
    sum += val * weights[i];
  }
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) {
    return { ok: false, normalized, warning: 'This NHI sequence cannot be valid (check digit would be 10).' };
  }
  const actual = Number(normalized[6]);
  if (actual !== check) {
    return {
      ok: false,
      normalized,
      warning: `NHI check digit looks wrong (expected ${check}, got ${actual}).`,
    };
  }
  return { ok: true, normalized };
}
