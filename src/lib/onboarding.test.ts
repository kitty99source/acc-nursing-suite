import { describe, expect, it } from 'vitest';
import { gettingStartedSteps, shouldShowGettingStarted } from './onboarding';
import { emptyData, sampleData } from './sampleData';
import { normalizeData } from './storage';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../types';

describe('onboarding', () => {
  it('shows getting started until dismissed', () => {
    expect(shouldShowGettingStarted({ gettingStartedDismissed: false })).toBe(true);
    expect(shouldShowGettingStarted({ gettingStartedDismissed: true })).toBe(false);
  });

  it('checklist is at most 3 steps and points at review first', () => {
    const steps = gettingStartedSteps(sampleData());
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(steps[0]?.id).toBe('review-accept');
    expect(steps[0]?.moduleId).toBe('review');
    expect(steps.some((s) => s.id === 'real-work')).toBe(true);
  });

  it('marks real-work incomplete while only sample data exists', () => {
    const steps = gettingStartedSteps(sampleData());
    const real = steps.find((s) => s.id === 'real-work');
    expect(real?.done).toBe(false);
    expect(real?.actionLabel).toMatch(/Clear/i);
  });

  it('marks real-work done when non-sample patients exist', () => {
    const data = emptyData();
    data.patients = [
      {
        id: 'p_real_1',
        name: 'Real Patient',
        nhi: 'ABC1234',
        dob: '1980-01-01',
        notes: '',
      },
    ];
    const real = gettingStartedSteps(data).find((s) => s.id === 'real-work');
    expect(real?.done).toBe(true);
  });

  it('DEFAULT_SETTINGS includes gettingStartedDismissed', () => {
    expect(DEFAULT_SETTINGS.gettingStartedDismissed).toBe(false);
  });

  it('normalizeData dismisses checklist for users who already saw the old welcome', () => {
    const legacy = emptyData();
    legacy.schemaVersion = SCHEMA_VERSION;
    const { gettingStartedDismissed: _drop, ...rest } = DEFAULT_SETTINGS;
    void _drop;
    legacy.settings = { ...rest, hasSeenWelcomeGuide: true } as typeof DEFAULT_SETTINGS;
    delete (legacy.settings as { gettingStartedDismissed?: boolean }).gettingStartedDismissed;

    const normalized = normalizeData(legacy);
    expect(normalized.settings.hasSeenWelcomeGuide).toBe(true);
    expect(normalized.settings.gettingStartedDismissed).toBe(true);
  });

  it('normalizeData keeps checklist for true first-run (welcome not seen)', () => {
    const fresh = emptyData();
    fresh.settings = { ...DEFAULT_SETTINGS, hasSeenWelcomeGuide: false };
    delete (fresh.settings as { gettingStartedDismissed?: boolean }).gettingStartedDismissed;
    const normalized = normalizeData(fresh);
    expect(normalized.settings.gettingStartedDismissed).toBe(false);
  });
});
