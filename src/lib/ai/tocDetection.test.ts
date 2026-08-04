import { describe, expect, it } from 'vitest';
import { isLikelyTableOfContents } from './tocDetection';

describe('isLikelyTableOfContents', () => {
  it('identifies a real leader-dot table-of-contents page', () => {
    const toc =
      'Table of Contents Useful Contact Information ' +
      '........................................................................................... 1 ' +
      'Useful Links .................................................................................................................. 2 ' +
      '1. Introduction ........................................................................................... 4 ' +
      '2. Who can hold this Contract? ................................................................................... 4 ' +
      '3. What does the contract cover? ............................................................................... 5 ' +
      '4. Seeking prior approval for surgery from ACC ................................................................ 7';
    expect(isLikelyTableOfContents(toc)).toBe(true);
  });

  it('does not flag substantive narrative clause text with many numbered sub-clauses', () => {
    // A real false-positive class found during this fix's own testing: heavily-numbered legal
    // clause text (5.3.1.1, 5.3.1.2, ...) looks numeric/repetitive but is genuinely substantive.
    const clauseText =
      'Page 15 of 40 5.3 Referral 5.3.1 Clients can only access these Services if they have been ' +
      'referred by one of the following: 5.3.1.1 A medical practitioner or treatment provider; ' +
      '5.3.1.2 ACC; or 5.3.1.3 Self-referral, the Client directly contacting the Service Provider ' +
      '(by phone or In-person). 5.4 Timeframes for accepting referrals 5.4.1 The Supplier must ' +
      'ensure that referrals are actioned within 2 working days of receipt.';
    expect(isLikelyTableOfContents(clauseText)).toBe(false);
  });

  it('does not flag a real price table with many rows/prices', () => {
    const priceTable =
      'ESS.Elective Surgery Services.2026 Page 11 of 80 Procedure Code Procedure Description Pricing (excl. GST) ' +
      'GNS06 Ventral Hernia Repair $6,129.12 GOP01 Bone Graft - any area, minor or small $6,529.27 ' +
      'GOP02 Bone Graft - any area, major $7,102.55 GOP03 Bone Graft - any area, revision $8,014.20';
    expect(isLikelyTableOfContents(priceTable)).toBe(false);
  });

  it('does not flag ordinary short narrative text', () => {
    expect(
      isLikelyTableOfContents(
        'The Supplier must ensure that all clinical notes are stored securely and are available for ACC audit on request.',
      ),
    ).toBe(false);
  });
});
