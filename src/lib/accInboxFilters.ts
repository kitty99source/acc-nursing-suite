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
  /** Parsed from subject "Claim:10000003194" (real ACC email format). */
  claimNumber?: string;
  /** Parsed from subject "ACCID:VEND-K96655". */
  accId?: string;
}

export const DEFAULT_ACC_INBOX_FILTERS: AccInboxFilterConfig = {
  senderAllowlist: ['acc.co.nz', 'acc.govt.nz', 'noreply@acc.co.nz'],
  subjectPatterns: [
    // Real ACC email format: "Mr Gilbert Gandor - Claim:10000003194 ACCID:VEND-K96655".
    /claim:/i,
    /accid:/i,
    /approv/i,
    /declin/i,
    /nur0[245]/i,
    /purchase order/i,
    /PO\s*number/i,
    /ACC\s+letter/i,
  ],
};

/**
 * Build filter config from Settings strings (office-config / P8-018).
 * Settings patterns MERGE with defaults (same rule as outlook-sync.ps1 since
 * 7cee0da) so Claim:/ACCID: are never dropped by a narrower office config.
 */
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
  const seen = new Set<string>();
  const mergedPatterns = [...patterns, ...DEFAULT_ACC_INBOX_FILTERS.subjectPatterns].filter((re) => {
    const key = re.source.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    senderAllowlist: senders.length > 0 ? senders : DEFAULT_ACC_INBOX_FILTERS.senderAllowlist,
    subjectPatterns: mergedPatterns,
  };
}

/**
 * Subject tokens that must survive the merge no matter what a user (or an
 * imported office-config) puts in Settings. Removing these from the editable
 * list is the exact 7cee0da regression that dropped John Bentley's letters, so
 * DEFAULT_ACC_INBOX_FILTERS re-adds them during accInboxConfigFromSettings().
 */
export const ACC_INBOX_REQUIRED_SUBJECT_TOKENS = ['Claim:', 'ACCID:'] as const;

/**
 * Which required tokens are absent from a user's subject-pattern list, so the
 * Settings UI can warn that defaults will still enforce them (P8-018 safeguard).
 * The merge guarantees they are never actually dropped — this only surfaces a
 * "we re-added these for you" notice.
 */
export function missingRequiredSubjectTokens(subjectPatternStrings: string[]): string[] {
  const haystack = subjectPatternStrings.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  return ACC_INBOX_REQUIRED_SUBJECT_TOKENS.filter(
    (token) => !haystack.some((s) => s.includes(token.toLowerCase())),
  );
}

/** Split a textarea (one entry per line) into a trimmed, de-duplicated string list. */
export function parseFilterLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/** Parse "Claim:10000003194" and "ACCID:VEND-K96655" from a real ACC subject line. */
export function parseSubjectMetadata(subject: string): { claimNumber?: string; accId?: string } {
  const claim = /claim:\s*(\d{6,})/i.exec(subject);
  const accId = /accid:\s*([A-Z]+-[A-Z0-9]+)/i.exec(subject);
  return {
    claimNumber: claim ? claim[1] : undefined,
    accId: accId ? accId[1].toUpperCase() : undefined,
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
