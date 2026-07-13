import { describe, expect, it } from 'vitest';
import { FAQ_ENTRIES, GUIDE_SECTIONS, filterFaq } from './helpContent';

describe('helpContent', () => {
  it('has non-empty guide sections with id, title, and body', () => {
    expect(GUIDE_SECTIONS.length).toBeGreaterThan(0);
    for (const s of GUIDE_SECTIONS) {
      expect(s.id.trim()).not.toBe('');
      expect(s.title.trim()).not.toBe('');
      expect(s.body.trim()).not.toBe('');
    }
  });

  it('has unique guide section ids', () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has FAQ entries with non-empty question, answer, and tags', () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThan(0);
    for (const e of FAQ_ENTRIES) {
      expect(e.id.trim()).not.toBe('');
      expect(e.question.trim()).not.toBe('');
      expect(e.answer.trim()).not.toBe('');
      expect(e.tags.length).toBeGreaterThan(0);
    }
  });

  it('has unique FAQ ids', () => {
    const ids = FAQ_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filterFaq returns all entries for empty/whitespace query', () => {
    expect(filterFaq(FAQ_ENTRIES, '')).toEqual(FAQ_ENTRIES);
    expect(filterFaq(FAQ_ENTRIES, '   ')).toEqual(FAQ_ENTRIES);
  });

  it('filterFaq matches question case-insensitively', () => {
    const hits = filterFaq(FAQ_ENTRIES, 'QUIET');
    expect(hits.some((e) => e.id === 'faq-quiet-launcher')).toBe(true);
  });

  it('filterFaq matches answer and tags', () => {
    const byAnswer = filterFaq(FAQ_ENTRIES, 'IndexedDB');
    expect(byAnswer.some((e) => e.id === 'faq-backup')).toBe(true);

    const byTag = filterFaq(FAQ_ENTRIES, 'lifecycle');
    expect(byTag.some((e) => e.id === 'faq-tab-close')).toBe(true);
  });

  it('filterFaq returns empty when nothing matches', () => {
    expect(filterFaq(FAQ_ENTRIES, 'zzzz-no-such-term-zzzz')).toEqual([]);
  });
});
