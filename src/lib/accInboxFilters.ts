/** ACC Inbox filter rules — narrow ACC letter emails only (P8-018 stub defaults). */

export interface AccInboxFilterConfig {
  senderAllowlist: string[];
  subjectPatterns: RegExp[];
}

export interface AccInboxRow {
  id: string;
  sender: string;
  subject: string;
  receivedAt: number;
  attachmentName: string;
  attachmentExt: string;
}

export const DEFAULT_ACC_INBOX_FILTERS: AccInboxFilterConfig = {
  senderAllowlist: ['acc.co.nz', 'acc.govt.nz', 'noreply@acc.co.nz'],
  subjectPatterns: [
    /approv/i,
    /declin/i,
    /nur0[245]/i,
    /purchase order/i,
    /PO\s*number/i,
    /ACC\s+letter/i,
  ],
};

export function matchesAccInboxSender(sender: string, allowlist: string[]): boolean {
  const lower = sender.toLowerCase();
  return allowlist.some((entry) => lower.includes(entry.toLowerCase()));
}

export function matchesAccInboxSubject(subject: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(subject));
}

export function isAccInboxCandidate(
  row: Pick<AccInboxRow, 'sender' | 'subject' | 'attachmentExt'>,
  config: AccInboxFilterConfig = DEFAULT_ACC_INBOX_FILTERS,
): boolean {
  const ext = row.attachmentExt.toLowerCase();
  if (ext !== '.pdf' && ext !== '.docx') return false;
  if (!matchesAccInboxSender(row.sender, config.senderAllowlist)) return false;
  return matchesAccInboxSubject(row.subject, config.subjectPatterns);
}

export function filterAccInboxRows(rows: AccInboxRow[], config?: AccInboxFilterConfig): AccInboxRow[] {
  return rows.filter((r) => isAccInboxCandidate(r, config));
}
