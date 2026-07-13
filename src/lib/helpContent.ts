// ============================================================================
// In-app instruction guide + FAQ content for the Help Center modal.
// Kept as plain data (no React) so it can be unit-tested and reused.
// Office-safe only — no patient/PHI examples.
// ============================================================================

export interface GuideSection {
  id: string;
  title: string;
  body: string;
}

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  tags: string[];
}

/**
 * Ordered walkthrough mirroring the Admin Suite sidebar.
 */
export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'big-picture',
    title: 'The big picture — end-to-end flow',
    body:
      'ACC District Nursing letters arrive in Outlook and are synced (or dropped) into ACC-Inbox, then staged into the Review Queue. ' +
      'You accept each item onto a patient/claim. Approvals, declines, billing invoices, remittances, complex cases, and compliance all live in their own modules. ' +
      'Everything stays offline on this PC (IndexedDB + optional .accdata backup).',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    body:
      'At-a-glance action queue: approvals nearing expiry, remittance follow-ups, declines waiting on docs, complex-case reviews, and compliance findings. ' +
      'Use it as the daily start page, then jump into the module that owns each item.',
  },
  {
    id: 'patients',
    title: 'Patients',
    body:
      'Patient demographics plus linked claims, service lines, and documents. Attach ACC letters here or via Review Queue accept. ' +
      'Notes and memos are local scratch — not sent to ACC automatically.',
  },
  {
    id: 'review',
    title: 'Review Queue (HRQ)',
    body:
      'Where synced or manually staged emails/attachments wait for a human accept. ' +
      'Status tabs, SLA highlighting, and confidence scores help you work the queue. ' +
      'Accept attaches the item to a patient/claim; nothing is auto-filed without you.',
  },
  {
    id: 'billing',
    title: 'Billing & Remittances',
    body:
      'Invoice lines, remittance status, and import history. Wrong remittance file? Use Remove import on that batch when available — ' +
      'it drops those payment lines and re-checks only the invoices that batch touched.',
  },
  {
    id: 'settings',
    title: 'Settings',
    body:
      'Appearance, idle lock, thresholds, ACC Inbox filters, service rates, backups, and dismissible assumption banners. ' +
      'Reopen this Help Center from the top bar or Settings any time.',
  },
  {
    id: 'save-load',
    title: 'Saving & loading your data',
    body:
      'The suite autosaves to this browser\'s IndexedDB. Use "Save my data" / "Load my data" in the top bar for a portable .accdata backup ' +
      '(optionally encrypted). IndexedDB protects against browser crashes; .accdata protects against disk wipes or a new PC.',
  },
];

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'faq-sidebar-badges',
    question: 'What do the red numbers on the sidebar mean?',
    answer:
      'They are attention counts, not page totals. Dashboard = open action-queue items; Approvals = billing approvals not Active; ' +
      'Billing = invoices in Awaiting Billing or Remittance; Declines / Complex / Compliance count items that need follow-up; ' +
      'Review Queue = pending staging letters waiting to accept. Hover a badge for context when labels are present.',
    tags: ['sidebar', 'badge', 'navigation', 'attention'],
  },
  {
    id: 'faq-quiet-launcher',
    question: 'How do I start the suite without PowerShell windows on the taskbar?',
    answer:
      'Pin a Desktop shortcut to "Start ACC Suite (quiet).vbs" (not the .cmd). ' +
      'It starts WFH Mode with -Quiet so the app server and Folder Watch run Hidden, opens the browser, and runs one Outlook sync. ' +
      'Logs still go to %USERPROFILE%\\ACC-Suite\\logs\\. Use the recommended .cmd when you want to watch sync progress in a console.',
    tags: ['launcher', 'quiet', 'wfh', 'desktop', 'vbs'],
  },
  {
    id: 'faq-tab-close',
    question: 'What happens when I close the browser tab?',
    answer:
      'Closing the last app browser tab stops the local app server and Folder Watch (including quiet/hidden mode). ' +
      'Recommended/view-only modes still keep a console window you can close with Ctrl+C. ' +
      'Your data stays in IndexedDB / your .accdata file — closing the tab does not wipe records.',
    tags: ['launcher', 'tab', 'close', 'quiet', 'lifecycle'],
  },
  {
    id: 'faq-undo-accept',
    question: 'I Accepted by mistake — how do I put it back in the Review Queue?',
    answer:
      'Right after Accept, use Undo on the green banner (about 45 seconds) when that toast is available. ' +
      'Later, open the accepted document on the patient claim and choose “Undo this accept” if shown — that restores the queue item when it is still soft-deleted. ' +
      'Outlook mail is never moved or reopened by undo.',
    tags: ['undo', 'accept', 'mistake', 'review'],
  },
  {
    id: 'faq-stage-to-idrive',
    question: 'I Accepted without filing to I-drive — can I stage later?',
    answer:
      'Yes. On the claim document (From Review Queue), use "Stage to I-drive" when the file is still stored locally and no staging path is recorded yet. ' +
      'It writes under _Staging using the Letters path grammar and saves the path so you can see it next time.',
    tags: ['idrive', 'staging', 'accept', 'retry', 'filing'],
  },
  {
    id: 'faq-remove-remittance',
    question: 'I imported the wrong remittance file — how do I undo it?',
    answer:
      'On Billing, open Remittance imports history and choose Remove import on that batch when available. ' +
      'It deletes only that file’s payment lines and re-checks status from any remittances that remain.',
    tags: ['remittance', 'billing', 'undo', 'remove', 'import'],
  },
  {
    id: 'faq-wfh',
    question: 'How do emails get into the Review Queue?',
    answer:
      'On the work PC, pin a Desktop shortcut to Start ACC Suite (quiet).vbs (preferred), ' +
      'or use Start ACC Suite (recommended).cmd if you want a visible console. ' +
      'A hidden supervisor starts the app, folder-watch, and one Outlook sync of the configured shared mailbox, ' +
      'and silently restarts the app server / Folder Watch if they die mid-session. ' +
      'Sync only stages items — you still accept each one in the Review Queue. ' +
      'Closing the last app browser tab ends the session.',
    tags: ['outlook', 'sync', 'wfh', 'launcher', 'review', 'quiet', 'supervisor'],
  },
  {
    id: 'faq-banners',
    question: 'What are the yellow assumption banners?',
    answer:
      'They surface decisions seeded from defaults that still need a human check ' +
      '(ACC Inbox filters, remittance stale days, and similar). ' +
      'Dismiss each once verified; they reappear if you clear the flag in Settings. Dismissing does not delete the underlying settings.',
    tags: ['banner', 'assumption', 'settings', 'confirm'],
  },
  {
    id: 'faq-backup',
    question: 'Why do .accdata backups matter if IndexedDB autosaves?',
    answer:
      'Autosave keeps you safe from browser crashes on this PC. A .accdata export is what you need ' +
      'if the disk is wiped, the browser profile is cleared, or you move to another computer. ' +
      'Use Save my data in the top bar regularly.',
    tags: ['backup', 'accdata', 'save', 'export'],
  },
  {
    id: 'faq-offline',
    question: 'Does this app send data over the internet?',
    answer:
      'No. It is 100% offline. Data lives in IndexedDB and whatever .accdata file you choose. ' +
      'The local launcher bridge talks only to 127.0.0.1 on your machine (Outlook COM / inbox paths via PowerShell).',
    tags: ['offline', 'privacy', 'network'],
  },
  {
    id: 'faq-help-again',
    question: 'How do I open this guide again later?',
    answer:
      'Click the Help (?) button in the top bar, or open Settings → Help & instructions → Open instruction guide. ' +
      'The guide only auto-opens once on first startup; reopening never resets that.',
    tags: ['help', 'guide', 'faq', 'settings'],
  },
];

/** Case-insensitive search across question, answer, and tags. */
export function filterFaq(entries: FaqEntry[], query: string): FaqEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => {
    const hay = [e.question, e.answer, ...e.tags].join(' ').toLowerCase();
    return hay.includes(q);
  });
}
