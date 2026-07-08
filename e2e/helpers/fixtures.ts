import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to a synthetic (no-PHI) fixture under e2e/fixtures. */
export function fixturePath(name: string): string {
  return join(here, '..', 'fixtures', name);
}

export const FIXTURES = {
  approvalPdf: 'approval-letter.pdf',
  approvalDocx: 'approval-letter.docx',
  declinePdf: 'decline-letter.pdf',
  corruptPdf: 'corrupt-letter.pdf',
} as const;
