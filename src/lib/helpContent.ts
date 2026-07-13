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
      'ACC District Nursing letters arrive in Outlook and are synced (or dropped) into ACC-Inbox, then staged into the Review Queue (HRQ). ' +
      'You accept each item onto a patient/claim. Approvals, declines, billing invoices, remittances, complex cases, compliance, Package Calculator, and Export Center all live in their own modules. ' +
      'Everything stays offline on this PC (IndexedDB + optional .accdata / Excel backup).',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    body:
      'At-a-glance action queue: approvals nearing expiry, remittance follow-ups, declines waiting on docs, complex-case reviews, and compliance findings. ' +
      'Use it as the daily start page, then jump into the module that owns each item. Sidebar badges are attention counts — not page totals.',
  },
  {
    id: 'patients',
    title: 'Patients',
    body:
      'Patient demographics plus linked claims, service lines, and documents. Attach ACC letters here or via Review Queue accept. ' +
      'If Accept skipped I-drive, use Stage to I-drive on the claim document. Notes and memos are local scratch — not sent to ACC automatically.',
  },
  {
    id: 'review',
    title: 'Review Queue (HRQ)',
    body:
      'Human Review Queue: synced or manually staged emails/attachments wait for a human accept. ' +
      'Status tabs, SLA highlighting, and confidence scores help you work the queue. ' +
      'Accept attaches the item to a patient/claim; optional I-drive checkbox stages under _Staging only. Nothing is auto-filed without you.',
  },
  {
    id: 'calculator',
    title: 'Package Calculator',
    body:
      'Determines NS01–NS03 package of care from Day 1 date, duration, consult counts, and interruptions. ' +
      'Rates come from Settings → Contract pricing (excl GST). The calculator does not submit claims to ACC.',
  },
  {
    id: 'billing',
    title: 'Billing & Remittances',
    body:
      'Invoice lines, remittance status, Needs review flags, and import history. Wrong remittance file? Use Remove import on that batch when available — ' +
      'it drops those payment lines and re-checks only the invoices that batch touched.',
  },
  {
    id: 'export',
    title: 'Export Center',
    body:
      'Excel workbook export/import (multi-tab toolkit replacement), plus JSON/.accdata backup and restore. Everything stays on this machine.',
  },
  {
    id: 'settings',
    title: 'Settings',
    body:
      'Appearance, idle lock, thresholds, ACC Inbox filters, service rates, I-drive paths, backups, Helper Mode, and dismissible assumption banners. ' +
      'Reopen Help from the top bar or Settings any time; use ? for Helper Mode hover tips.',
  },
  {
    id: 'save-load',
    title: 'Saving & loading your data',
    body:
      'The suite autosaves to this browser\'s IndexedDB. Use "Save my data" / "Load my data" in the top bar for a portable .accdata backup ' +
      '(optionally encrypted). IndexedDB protects against browser crashes; .accdata / Excel protect against disk wipes or a new PC.',
  },
];

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'faq-helper-mode',
    question: 'What is Helper Mode (the ? button in the top bar)?',
    answer:
      'Helper Mode is an optional coaching layer (off by default). Turn it on with the ? button in the top bar or Settings → Helper Mode. ' +
      'When on, hovering or focusing key buttons and badges shows a short explainer popover — it does not trap your mouse or block clicks. ' +
      'Press Esc or move away to dismiss. “Learn more” opens this Help Center on the matching FAQ. Turn it off the same way when you no longer need tips.',
    tags: ['helper', 'help', 'tips', 'topbar', 'settings'],
  },
  {
    id: 'faq-quiet-launcher',
    question: 'How do I start the suite without PowerShell windows on the taskbar?',
    answer:
      'Pin a Desktop shortcut to "Start ACC Suite (quiet).vbs" (not the .cmd). ' +
      'It starts WFH Mode with -Quiet so the app server and Folder Watch run Hidden, opens the browser, and runs one Outlook sync. ' +
      'A hidden supervisor silently restarts the app server / Folder Watch if they die mid-session. ' +
      'Logs still go to %USERPROFILE%\\ACC-Suite\\logs\\. Use the recommended .cmd when you want to watch sync progress in a console.',
    tags: ['launcher', 'quiet', 'wfh', 'desktop', 'vbs', 'supervisor'],
  },
  {
    id: 'faq-tab-close',
    question: 'What happens when I close the browser tab?',
    answer:
      'Closing the last app browser tab stops the local app server and Folder Watch (including quiet/hidden mode). ' +
      'Recommended/view-only modes still keep a console window you can close with Ctrl+C. ' +
      'Your data stays in IndexedDB / your .accdata file — closing the tab does not wipe records. Re-open via the quiet .vbs or recommended .cmd.',
    tags: ['launcher', 'tab', 'close', 'quiet', 'lifecycle'],
  },
  {
    id: 'faq-connecting',
    question: 'What is the difference between “Connecting” and “Reconnecting”?',
    answer:
      'Connecting to local helper = the suite has not yet reached the /_acc bridge on this PC (common briefly after launch). ' +
      'Reconnecting = the bridge was available earlier and then dropped — the quiet-mode supervisor usually restarts it; wait a few seconds. ' +
      'If stuck, re-launch via the quiet .vbs. `npm run dev` has no /_acc bridge — use the launcher for Outlook/I-drive.',
    tags: ['connecting', 'reconnecting', 'bridge', 'launcher', 'supervisor'],
  },
  {
    id: 'faq-folder-watch',
    question: 'What is Folder Watch / how do drop-in files get into Review Queue?',
    answer:
      'Folder Watch (started by the launcher) notices new files in ACC-Inbox and stages them into the Review Queue (HRQ). ' +
      'Outlook sync also stages mail from the configured shared mailbox filters. Staging only queues items — you still Accept each one. ' +
      'If Folder Watch stops, close the last tab and re-launch with the quiet .vbs.',
    tags: ['folder', 'watch', 'inbox', 'staging', 'review', 'hrq'],
  },
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
    id: 'faq-hrq',
    question: 'What is HRQ / the Review Queue?',
    answer:
      'HRQ means Human Review Queue — the Review Queue module. Letters synced from Outlook or dropped into ACC-Inbox land here for you to check and Accept onto a patient/claim. ' +
      'Nothing counts toward metrics until accepted. There is an optional auto-accept for high-confidence eligible items you explicitly run; it never files blindly in the background.',
    tags: ['hrq', 'review', 'accept', 'queue'],
  },
  {
    id: 'faq-undo-accept',
    question: 'I Accepted by mistake — how do I put it back in the Review Queue?',
    answer:
      'Right after Accept, use Undo on the green banner (about 45 seconds) when that toast is available. ' +
      'Later, open the accepted document on the patient claim and choose “Undo this accept” if shown — that restores the queue item when it is still soft-deleted. ' +
      'Outlook mail is never moved or reopened by undo.',
    tags: ['undo', 'accept', 'mistake', 'review', 'hrq'],
  },
  {
    id: 'faq-stage-to-idrive',
    question: 'What does the I-drive checkbox / Stage to I-drive do?',
    answer:
      'Optional “Also file to I-drive” on Accept stages a copy under _Staging using the Letters path grammar — not into the live District Nursing archive. ' +
      'If you Accepted without filing, use “Stage to I-drive” on the claim document when the file is still stored locally and no staging path is recorded yet. ' +
      'I-drive root and staging subfolder are editable in Settings.',
    tags: ['idrive', 'staging', 'accept', 'retry', 'filing', 'settings'],
  },
  {
    id: 'faq-needs-review',
    question: 'What does Billing “Needs review” mean?',
    answer:
      'After remittance import, held/declined or mismatched invoice lines are flagged Needs review (often with an ACC reason code when found). ' +
      'Use the Needs review filter/tab to work that slice. It is not “every invoice on the page”, and sidebar Billing badge attention is related but may use broader awaiting-billing/remittance rules.',
    tags: ['billing', 'needs-review', 'remittance', 'attention'],
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
    id: 'faq-calculator',
    question: 'How does the Package Calculator work (and what are the quirks)?',
    answer:
      'Enter Day 1 (start of package), duration/consults, and any interruptions — the calculator recommends NS01 (1–13 days), NS02 (14–42), or NS03 (43–105) with min consult rules. ' +
      'Package values use your editable contract rates in Settings (dollars excl GST). It does not submit to ACC or create invoices by itself. ' +
      'Quirks: interruptions can change the recommended package; rates must match your current ACC schedule (edit them when ACC updates prices — there is no fixed “reset to factory”).',
    tags: ['calculator', 'package', 'NS01', 'NS02', 'NS03', 'gst', 'rates'],
  },
  {
    id: 'faq-export-excel',
    question: 'What does Export Center’s Excel workbook do?',
    answer:
      'Export builds a multi-tab .xlsx (Start Here, Billing Log, Year Summary, NS04-NS05 Approvals, Complex Cases, Decline Tracker, Management Summary) with dropdowns and totals — it replaces the old toolkit spreadsheet. ' +
      'Import reads recognised tabs back in (with a preview); unknown columns/sheets become custom fields/tables. JSON/.accdata backup is separate for full app restore.',
    tags: ['export', 'excel', 'xlsx', 'toolkit', 'backup'],
  },
  {
    id: 'faq-settings-paths',
    question: 'Which Settings paths matter on the work PC?',
    answer:
      'ACC Inbox sender allowlist and subject patterns control what Outlook sync stages. I-drive root (default I:\\ACC\\District Nursing) and staging subfolder (default _Staging) control optional Accept writeback. ' +
      'Remittance stale days, expiry threshold, service rates, and assumption-banner dismiss flags also live here. Mirror launcher mailbox config into office-config.json when you change sync targets.',
    tags: ['settings', 'inbox', 'idrive', 'paths', 'filters'],
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
    tags: ['outlook', 'sync', 'wfh', 'launcher', 'review', 'quiet', 'supervisor', 'hrq'],
  },
  {
    id: 'faq-banners',
    question: 'What are the yellow assumption banners?',
    answer:
      'They surface decisions seeded from defaults that still need a human check ' +
      '(ACC Inbox filters, remittance stale days, I-drive filing, Mail Reference, and similar). ' +
      'Dismiss each once verified; they reappear if you clear the flag in Settings. Dismissing does not delete the underlying settings.',
    tags: ['banner', 'assumption', 'settings', 'confirm'],
  },
  {
    id: 'faq-backup',
    question: 'Why do .accdata backups matter if IndexedDB autosaves?',
    answer:
      'Autosave keeps you safe from browser crashes on this PC. A .accdata export (or Export Center Excel/JSON) is what you need ' +
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
      'Click Help in the top bar, or open Settings → Help & instructions → Open instruction guide. ' +
      'The ? button toggles Helper Mode (hover tips), not the full guide. ' +
      'The guide only auto-opens once on first startup; reopening never resets that.',
    tags: ['help', 'guide', 'faq', 'settings', 'helper'],
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

export function getFaqById(id: string): FaqEntry | undefined {
  return FAQ_ENTRIES.find((e) => e.id === id);
}
