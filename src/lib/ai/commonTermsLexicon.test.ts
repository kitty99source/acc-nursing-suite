import { describe, expect, it } from 'vitest';
import {
  COMMON_TERMS_LEXICON,
  buildLexiconSections,
  matchLexiconTerms,
} from './commonTermsLexicon';

describe('matchLexiconTerms', () => {
  it('retrieves PHAS for a district-nursing / PHAS question', () => {
    const hits = matchLexiconTerms('would district nursing services ever come under PHAS?');
    expect(hits.some((h) => h.term === 'PHAS')).toBe(true);
    const phas = hits.find((h) => h.term === 'PHAS')!;
    expect(phas.expansion).toMatch(/Public Health Acute Services/i);
    expect(phas.definition.toLowerCase()).toContain('acute');
    expect(phas.notes?.toLowerCase()).toMatch(/district|community nursing/);
    expect(phas.notes?.toLowerCase()).toMatch(/not/);
  });

  it('matches full-phrase alias for PHAS', () => {
    const hits = matchLexiconTerms('Explain Public Health Acute Services funding');
    expect(hits.some((h) => h.term === 'PHAS')).toBe(true);
  });

  it('does not dump the whole lexicon for an unrelated question', () => {
    const hits = matchLexiconTerms('geneva conventions medical transport');
    expect(hits).toEqual([]);
  });

  it('matches NS04 without pulling every NS0x code', () => {
    const hits = matchLexiconTerms('When does NS04 need prior approval?');
    expect(hits.some((h) => h.term === 'NS04')).toBe(true);
    expect(hits.some((h) => h.term === 'NS01')).toBe(false);
  });

  it('keeps PHAS distinct from PHO', () => {
    const phasOnly = matchLexiconTerms('what is PHAS');
    expect(phasOnly.some((h) => h.term === 'PHAS')).toBe(true);
    expect(phasOnly.some((h) => h.term === 'PHO')).toBe(false);

    const phoOnly = matchLexiconTerms('what is a PHO');
    expect(phoOnly.some((h) => h.term === 'PHO')).toBe(true);
    expect(phoOnly.some((h) => h.term === 'PHAS')).toBe(false);
  });

  it('matches Service Schedule / schedules for ACC-sense grounding (not calendar metaphors)', () => {
    const hits = matchLexiconTerms(
      'What are some other distinctly different schedules like this?',
    );
    expect(hits.some((h) => h.term === 'Service Schedule')).toBe(true);
    const ss = hits.find((h) => h.term === 'Service Schedule')!;
    expect(ss.definition.toLowerCase()).toMatch(/service schedule/);
    expect(ss.definition.toLowerCase()).toMatch(/elective surgery|allied health|nursing/);
    // Explicitly rejects calendar metaphors (must say what it is NOT).
    expect(ss.definition.toLowerCase()).toMatch(/not a school timetable/);
    expect(ss.notes?.toLowerCase()).toMatch(/other schedules like this/);
  });
});

describe('buildLexiconSections', () => {
  it('returns empty when no terms matched', () => {
    expect(buildLexiconSections([])).toEqual([]);
  });

  it('renders matched terms with expansion and source note', () => {
    const phas = COMMON_TERMS_LEXICON.find((t) => t.term === 'PHAS')!;
    const sections = buildLexiconSections([phas]).join('\n');
    expect(sections).toMatch(/PHAS/);
    expect(sections).toMatch(/Public Health Acute Services/);
    expect(sections.toLowerCase()).toContain('source note');
    expect(sections.toLowerCase()).toContain('reference material');
  });
});
