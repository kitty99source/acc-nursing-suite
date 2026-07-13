import { describe, expect, it } from 'vitest';
import {
  buildAdminIDriveRelativePath,
  buildStagingRelativePath,
  formatNameLastFirst,
  joinIDriveDisplayPath,
  needsInitialAdminIDriveStaging,
} from './idriveFiling';

describe('idriveFiling (Admin District Nursing)', () => {
  it('formats LASTNAME, Firstname', () => {
    expect(formatNameLastFirst('Aroha Brown')).toBe('BROWN, Aroha');
  });

  it('builds Letters\\year\\month\\patient claim\\file path', () => {
    const built = buildAdminIDriveRelativePath({
      patientName: 'Jane Doe',
      claimNumber: 'NH00001',
      letterDate: '2026-03-09',
      sourceFileName: 'approval.pdf',
    });
    expect(built.relativePath).toBe(
      'Letters\\2026\\March\\DOE, Jane NH00001\\approval.pdf',
    );
  });

  it('prefixes _Staging for writeback', () => {
    expect(buildStagingRelativePath('Letters\\2026\\March\\x.pdf', '_Staging')).toBe(
      '_Staging\\Letters\\2026\\March\\x.pdf',
    );
  });

  it('joins display paths', () => {
    expect(joinIDriveDisplayPath('I:\\ACC\\District Nursing', '_Staging\\Letters\\a.pdf')).toBe(
      'I:\\ACC\\District Nursing\\_Staging\\Letters\\a.pdf',
    );
  });

  it('needsInitialAdminIDriveStaging only for Accepts without filing metadata', () => {
    expect(needsInitialAdminIDriveStaging({ fromReviewAccept: true })).toBe(true);
    expect(
      needsInitialAdminIDriveStaging({
        fromReviewAccept: true,
        lastIDriveFiling: { relativePath: '_Staging\\Letters\\x.pdf', filedAt: '2026-07-01' },
      }),
    ).toBe(false);
    expect(needsInitialAdminIDriveStaging({ fromReviewAccept: false })).toBe(false);
    expect(needsInitialAdminIDriveStaging({})).toBe(false);
  });
});
