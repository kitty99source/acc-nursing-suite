import { describe, it, expect } from 'vitest';
import {
  adminIDriveTopFolderForKind,
  classifyReviewMailKind,
  classifyReviewServiceCategory,
  classifyStagingReviewCategories,
  reviewMailKindToDocumentKind,
} from './reviewQueueCategories';
import type { StagingItem } from './staging';

function item(partial: Partial<StagingItem> & Pick<StagingItem, 'title'>): StagingItem {
  return {
    id: 't1',
    type: 'letter-import-pending',
    status: 'pending',
    source: 'email',
    createdAt: 1,
    severity: 'info',
    summary: '',
    ...partial,
  };
}

describe('reviewQueueCategories', () => {
  it('classifies NUR02 / nursing services approve as ACC approval letter', () => {
    expect(
      classifyReviewMailKind(
        item({
          title: 'Folder: letter',
          sourceFileName: '1_NUR02_Nursing_services_approve_-_vendor.docx',
          emailSubject: 'Ms Sample - Claim:90000000001',
        }),
      ),
    ).toBe('acc-approval-letter');
  });

  it('classifies approval-request subjects aside from ACC letters', () => {
    expect(
      classifyReviewMailKind(
        item({
          title: 'Request',
          emailSubject: 'NS04 approval request — Claim:90000000099',
          sourceFileName: 'request-scan.pdf',
        }),
      ),
    ).toBe('approval-request');
  });

  it('classifies NUR04 / decline tokens as decline letters', () => {
    expect(
      classifyReviewMailKind(
        item({
          title: 'Decline',
          sourceFileName: '1_NUR04VEN_Decline.docx',
          emailSubject: 'Decline of nursing services',
        }),
      ),
    ).toBe('acc-decline-letter');
  });

  it('prefers parse hint letterKind over filename heuristics', () => {
    expect(
      classifyReviewMailKind(
        item({
          title: 'x',
          sourceFileName: 'something-request.pdf',
        }),
        { letterKind: 'approval' },
      ),
    ).toBe('acc-approval-letter');
  });

  it('picks latest NS04/NS05 from service rows (current stamp)', () => {
    const service = classifyReviewServiceCategory(item({ title: 'x' }), {
      serviceRows: [
        {
          serviceCode: 'NS04',
          approvalStartDate: '2025-01-01',
          approvalEndDate: '2025-06-01',
          approvedHoursOrConsults: 5,
        },
        {
          serviceCode: 'NS05',
          approvalStartDate: '2025-06-02',
          approvalEndDate: '2026-06-01',
          approvedHoursOrConsults: 20,
        },
      ],
    });
    expect(service).toBe('NS05');
  });

  it('falls back to last NS0x token in subject/filename', () => {
    expect(
      classifyReviewServiceCategory(
        item({
          title: 'x',
          emailSubject: 'Cover for NS04 then renewal NS05',
        }),
      ),
    ).toBe('NS05');
    expect(
      classifyReviewServiceCategory(
        item({
          title: 'x',
          sourceFileName: 'Smith-Jane_Claim9_NS04_approval.pdf',
        }),
      ),
    ).toBe('NS04');
    expect(classifyReviewServiceCategory(item({ title: 'newsletter' }))).toBe('unknown');
  });

  it('maps mail kinds onto DocumentKind + I-drive top folders', () => {
    expect(reviewMailKindToDocumentKind('acc-approval-letter')).toBe('acc-approval-letter');
    expect(reviewMailKindToDocumentKind('approval-request')).toBe('approval-request');
    expect(adminIDriveTopFolderForKind('acc-approval-letter')).toBe('Letters');
    expect(adminIDriveTopFolderForKind('approval-request')).toBe('Approval Requests');
  });

  it('classifyStagingReviewCategories reads loose parsedPreview service rows', () => {
    const cats = classifyStagingReviewCategories(
      item({
        title: 'Folder: x.pdf',
        sourceFileName: 'mystery.pdf',
        parsedPreview: {
          kind: 'approval',
          confidence: 40,
          patientName: '',
          parsed: {
            kind: 'approval',
            serviceRows: [
              {
                serviceCode: 'NS04',
                approvalStartDate: '2025-01-01',
                approvalEndDate: '2025-03-01',
                approvedHoursOrConsults: 3,
              },
            ],
          },
        } as StagingItem['parsedPreview'],
      }),
    );
    expect(cats.mailKind).toBe('acc-approval-letter');
    expect(cats.service).toBe('NS04');
  });
});
