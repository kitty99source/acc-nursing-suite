/** ACC Inbox filter rules — narrow ACC letter emails only (P8-018). */

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

/** Build filter config from Settings strings (office-config / P8-018). */
export function accInboxConfigFromSettings(
  senderAllowlist: string[],
  subjectPatternStrings: string[],
): AccInboxFilterConfig {
  const senders = senderAllowlist.filter((s) => s.trim().length > 0);
  const patterns = subjectPatternStrings
    .filter((s) => s.trim().length > 0)
    .map((s) => {
      try {
        return new RegExp(s, 'i');
      } catch {
        return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
    });
  return {
    senderAllowlist: senders.length > 0 ? senders : DEFAULT_ACC_INBOX_FILTERS.senderAllowlist,
    subjectPatterns: patterns.length > 0 ? patterns : DEFAULT_ACC_INBOX_FILTERS.subjectPatterns,
  };
}

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
