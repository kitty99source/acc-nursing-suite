import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';
import { FAQ_ENTRIES } from './helpContent';
import { HELPER_TIPS, helperTipsHaveValidFaqs, getHelperTip } from './helperTips';

describe('helperTips', () => {
  it('defaults helperModeEnabled to false', () => {
    expect(DEFAULT_SETTINGS.helperModeEnabled).toBe(false);
  });

  it('has unique tip ids', () => {
    const ids = HELPER_TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tip links to an existing FAQ', () => {
    expect(helperTipsHaveValidFaqs()).toBe(true);
    for (const tip of HELPER_TIPS) {
      expect(FAQ_ENTRIES.some((e) => e.id === tip.faqId)).toBe(true);
      expect(tip.title.trim()).not.toBe('');
      expect(tip.body.trim()).not.toBe('');
    }
  });

  it('getHelperTip returns known tips', () => {
    expect(getHelperTip('tip-accept')?.faqId).toBe('faq-undo-accept');
    expect(getHelperTip('no-such-tip')).toBeUndefined();
  });
});
