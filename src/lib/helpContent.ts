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
      'Everything stays offline on this PC (IndexedDB + optional .accdata / Excel / ZIP backup).',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    body:
      'At-a-glance action queue: approvals nearing expiry, remittance follow-ups, declines waiting on docs, complex-case reviews, and compliance findings. ' +
      'Use it as the daily start page, then jump into the module that owns each item. Sidebar badges are attention counts — not page totals. ' +
      'Import ACC letter is also available here for a one-step patient/claim/approval filing.',
  },
  {
    id: 'review',
    title: 'Review Queue (HRQ)',
    body:
      'Human Review Queue: synced or manually staged emails/attachments wait for a human accept. ' +
      'Tabs split Under review / Unnamed / Deferred / Auto-approve. Category filters split ACC approval letters, approval requests, declines, and NS04 vs NS05. ' +
      'Default filter shows ACC approval letters (most actionable). Save as chooses approval letter vs approval request vs decline — requests do not create NS04/NS05 periods. ' +
      'Accept attaches the item to a patient/claim; optional I-drive checkbox stages under _Staging (Letters or Approval Requests). ' +
      'Auto-accept ready only runs when you click it, and only for 100%-confidence eligible items.',
  },
  {
    id: 'accinbox',
    title: 'ACC Inbox',
    body:
      'Shows what Outlook sync / Folder Watch last saw in the configured shared mailbox and ACC-Inbox staging folder. ' +
      'Refresh sync status shows a progress panel with elapsed time (Connecting / Fetching / still running) — Cancel wait only stops waiting in the UI, not Outlook. ' +
      'Open Review Queue jumps to HRQ; Advanced stage writes a queue row without waiting for folder-watch. ' +
      'Sender allowlist and subject patterns live in Settings.',
  },
  {
    id: 'patients',
    title: 'Patients & Cases',
    body:
      'Patient demographics plus linked claims, service lines, and documents. Attach ACC letters here or via Review Queue accept. ' +
      'If Accept skipped I-drive, use Stage to I-drive on the claim document. Use Undo this accept when you need the letter back in HRQ. ' +
      'Notes and memos are local scratch — not sent to ACC automatically.',
  },
  {
    id: 'approvals',
    title: 'Approvals (NS04/NS05)',
    body:
      'Tracks NS04/NS05 approval periods and expiry. Import an ACC approval letter (NUR02-style) to file periods onto a claim. ' +
      'NS03 packages no longer need approval (ACC change, March 2025) — those letters can be filed as historic records without billing. ' +
      'Sidebar Approvals badge counts approvals that are not Active.',
  },
  {
    id: 'declines',
    title: 'Decline Tracker',
    body:
      'Declined letters and follow-up status. Import a decline letter from Declines or Patients. ' +
      'Work items that still need documentation or a re-request; the sidebar badge counts open follow-ups.',
  },
  {
    id: 'billing',
    title: 'Billing Log & Remittances',
    body:
      'Invoice lines, remittance status, Needs review flags, and import history. Wrong remittance file? Use Remove import on that batch when available — ' +
      'it drops those payment lines and re-checks only the invoices that batch touched. ' +
      'Quick Paste-In (when enabled in Settings) pastes billing-report rows into invoice lines.',
  },
  {
    id: 'complex',
    title: 'Complex Cases',
    body:
      'Longer-running or exception cases that need review outside the normal package flow. ' +
      'Export Center includes a Complex Cases Excel tab; import can merge those rows back.',
  },
  {
    id: 'compliance',
    title: 'Flagged (Compliance)',
    body:
      'Contract-compliance findings (e.g. missing approvals). Import an approval letter from here to file NS04/NS05 periods and clear related flags. ' +
      'Sidebar badge counts open findings that need attention.',
  },
  {
    id: 'calculator',
    title: 'Package Calculator',
    body:
      'Determines NS01–NS03 package of care from Day 1 date, duration, consult counts, and interruptions. ' +
      'Rates come from Settings → Contract pricing (excl GST). The calculator does not submit claims to ACC.',
  },
  {
    id: 'export',
    title: 'Export Center',
    body:
      'Excel workbook export/import (multi-tab toolkit replacement), JSON/.accdata backup and restore, and full ZIP with document blobs. ' +
      'Excel import shows a preview and can be rolled back. Everything stays on this machine.',
  },
  {
    id: 'mail-reference',
    title: 'Mail Reference',
    body:
      'Searchable office reference for ACC form codes and where they go (email / CC / hand-off). ' +
      'Seeded from the 2024 Team Processes sheet — edit freely; Reset to 2024 defaults restores the seed. Not patient data.',
  },
  {
    id: 'settings',
    title: 'Settings',
    body:
      'Appearance, idle lock, thresholds, ACC Inbox filters, service rates, I-drive paths, backups, Helper Mode, Fun/easter eggs, and dismissible assumption banners. ' +
      'Reopen Help from the top bar or Settings any time; use ? for Helper Mode hover tips.',
  },
  {
    id: 'fun',
    title: 'Fun / Easter eggs',
    body:
      'Optional decorative extras near the top of Settings → Fun / Easter eggs: dancing disco cats, cute mouse cursors, and a walking companion. ' +
      'All off by default; they never touch patient or billing data. Triple-click the teal “NS” badge at the top of the sidebar to toggle disco cats for this session.',
  },
  {
    id: 'save-load',
    title: 'Saving & loading your data',
    body:
      'The suite autosaves to this browser\'s IndexedDB. Use "Save my data" / "Load my data" in the top bar for a portable .accdata backup ' +
      '(optionally encrypted). IndexedDB protects against browser crashes; .accdata / Excel / ZIP protect against disk wipes or a new PC.',
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
    id: 'faq-dashboard',
    question: 'What should I do first on the Dashboard?',
    answer:
      'Treat Dashboard as today’s work list: open action-queue rows (expiring approvals, remittance follow-ups, declines, complex cases, compliance), ' +
      'then the “letters waiting in Review Queue” card. Use Import ACC letter when a PDF/Word arrived outside Outlook sync. ' +
      'Sidebar Dashboard badge = open action items, not every chart total on the page.',
    tags: ['dashboard', 'action', 'queue', 'start'],
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
    id: 'faq-queue-tabs',
    question: 'What is the difference between Under review, Unnamed, Deferred, and Auto-approve?',
    answer:
      'Under review = active pending letters. Unnamed = pending rows that still show a filename only (try Fix names now before Discard unnamed). ' +
      'Deferred = letters you set aside; bring them back from that tab. Auto-approve = pending letters currently eligible for one-click Auto-accept ready ' +
      '(100% confidence, no blockers) — still only files when you click the button.',
    tags: ['review', 'tabs', 'unnamed', 'deferred', 'auto-accept', 'hrq'],
  },
  {
    id: 'faq-review-categories',
    question: 'How do Review Queue categories (NS04/NS05 and approval vs request) work?',
    answer:
      'Category filters sit under the status tabs and split the current list by mail kind and latest approval service. ' +
      'ACC approval letter = NUR02-style ACC letter that can file NS04/NS05 periods. Approval request = a request that is not yet an ACC approval — set these aside and Save as approval request (no periods). ' +
      'NS04 / NS05 come from parsed service rows when available, otherwise from subject/filename tokens; Unknown means neither code was detected yet. ' +
      'Default filter is ACC approval letters so ~hundreds of mixed emails are not one flat list.',
    tags: ['review', 'categories', 'NS04', 'NS05', 'approval', 'request', 'hrq'],
  },
  {
    id: 'faq-save-as-outcome',
    question: 'What is the difference between Save as ACC approval letter vs approval request?',
    answer:
      'ACC approval letter Accept parses and files NS04/NS05 approval periods onto the claim, and stages under Letters\\… on I-drive when checked. ' +
      'Approval request attaches the file as document kind approval-request only (no periods) and stages under Approval Requests\\… — use this for requests you sent or mail that is not yet an ACC letter. ' +
      'Decline uses the decline Accept path. You can override the classifier with the Save as dropdown before accepting.',
    tags: ['review', 'accept', 'approval', 'request', 'idrive', 'hrq'],
  },
  {
    id: 'faq-acc-inbox-refresh',
    question: 'Why does Refresh sync status show a loading panel with elapsed time?',
    answer:
      'Refresh asks the local helper to check Outlook mail again, then waits for the report with a live elapsed timer (Starting local helper… / Checking mail…). ' +
      'Cancel wait only stops waiting in ACC Inbox — it does not cancel Outlook. If sync stops, you will see “Sync stopped — retry”. ' +
      'Outlook must be open and signed in. If leftovers from an old session fight the new one, run Stop ACC District Nursing Suite (force).',
    tags: ['inbox', 'sync', 'refresh', 'loading'],
  },
  {
    id: 'faq-auto-accept',
    question: 'Is Auto-accept safe? What does “Auto-accept ready (N)” do?',
    answer:
      'It only appears when N letters score 100% confidence with no outstanding issues. Clicking it asks for confirmation, then Accepts those eligible items in batch. ' +
      'Failures stay pending for manual review. It never runs in the background. Prefer individual Accept when anything looks odd.',
    tags: ['auto-accept', 'review', 'hrq', 'confidence'],
  },
  {
    id: 'faq-discard-unnamed',
    question: 'What does Discard unnamed do?',
    answer:
      'Removes pending Review Queue rows that still show a filename only (no patient name resolved). Try Fix names now first for anything that might be readable. ' +
      'Discarded items leave the queue; this is for junk/unreadable drops, not a soft defer.',
    tags: ['discard', 'unnamed', 'review', 'hrq'],
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
      'Optional “Also file to I-drive” on Accept stages a copy under _Staging using Letters\\… or Approval Requests\\… (by Save as / document kind) — not into the live District Nursing archive. ' +
      'If you Accepted without filing, use “Stage to I-drive” on the claim document when the file is still stored locally and no staging path is recorded yet. ' +
      'I-drive root and staging subfolder are editable in Settings.',
    tags: ['idrive', 'staging', 'accept', 'retry', 'filing', 'settings'],
  },
  {
    id: 'faq-letter-import',
    question: 'What does “Import ACC letter (PDF or Word)” do — and where should I use it?',
    answer:
      'Opens a letter parser that can create/update patient, claim, approvals/declines, and attach the PDF/Word. ' +
      'Full-save entry points: Dashboard, Patients, Approvals, Declines, Compliance, claim Documents. ' +
      'Prefill-from-letter on new patient/claim forms only fills fields — nothing saves until you click Save. ' +
      'Review Queue Accept is for already-staged inbox items; letter import is for a file you pick yourself.',
    tags: ['letter', 'import', 'pdf', 'word', 'approvals', 'patients'],
  },
  {
    id: 'faq-patients',
    question: 'How do Patients & Cases relate to claims and documents?',
    answer:
      'Each patient can have multiple claims; each claim holds service lines, approvals, and documents (including Review-accept attachments). ' +
      'Open a claim to see documents, Stage to I-drive, Undo this accept, and Re-extract on approval/decline letters. ' +
      'Local notes stay on this PC only.',
    tags: ['patients', 'claims', 'documents', 'cases'],
  },
  {
    id: 'faq-approvals',
    question: 'What are Approvals (NS04/NS05) — and does NS03 still need approval?',
    answer:
      'Approvals tracks NS04/NS05 period coverage and expiry for billing. Import an ACC approval letter to file periods onto a claim. ' +
      'NS03 packages no longer need approval (ACC change, March 2025); those letters can be stored as historic package records without creating billing periods. ' +
      'Sidebar badge counts approvals that are not Active (e.g. nearing expiry / needing attention).',
    tags: ['approvals', 'NS04', 'NS05', 'NS03', 'expiry'],
  },
  {
    id: 'faq-declines',
    question: 'What is the Decline Tracker for?',
    answer:
      'Tracks declined ACC letters and whether you still need docs or a follow-up. Import a decline letter from Declines or Patients. ' +
      'Sidebar Declines badge counts open follow-ups — not every historical decline row.',
    tags: ['declines', 'tracker', 'letter', 'follow-up'],
  },
  {
    id: 'faq-complex',
    question: 'What are Complex Cases?',
    answer:
      'A separate list for exception / longer-running cases outside the normal package path. Review them from Dashboard action items or the Complex Cases module. ' +
      'They export/import with the Excel workbook Complex Cases tab.',
    tags: ['complex', 'cases', 'exception'],
  },
  {
    id: 'faq-compliance',
    question: 'What does Flagged (Compliance) mean?',
    answer:
      'Contract-compliance findings such as missing NS04/NS05 approvals. Open a finding and import an approval letter to file periods and clear related flags when appropriate. ' +
      'Sidebar badge = open findings needing attention.',
    tags: ['compliance', 'flagged', 'approvals', 'contract'],
  },
  {
    id: 'faq-acc-inbox',
    question: 'What is the ACC Inbox module vs Review Queue?',
    answer:
      'ACC Inbox shows sync/staging visibility for the shared mailbox and ACC-Inbox folder. Review Queue (HRQ) is where you Accept items onto patients. ' +
      'Open Review Queue only navigates; Advanced stage can write a queue row without the launcher. Prefer Folder Watch + quiet launcher for day-to-day.',
    tags: ['accinbox', 'inbox', 'sync', 'review', 'hrq'],
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
    id: 'faq-quick-paste',
    question: 'What is Quick Paste-In?',
    answer:
      'Optional tool (enable in Settings) to paste tab- or comma-separated rows from a billing report, map columns, preview, then commit invoice lines locally. ' +
      'Nothing is sent anywhere. Prefer remittance/Excel import when you have those files; Quick Paste is for ad-hoc report rows.',
    tags: ['quickpaste', 'billing', 'paste', 'invoice'],
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
    id: 'faq-service-rates',
    question: 'Where do I edit NS01–NS03 (and other) contract rates?',
    answer:
      'Settings → Contract pricing. Rates are dollars excl GST and stay as you leave them (no factory reset). ' +
      'Package Calculator and billing displays read these values. Update them when ACC publishes a new schedule.',
    tags: ['settings', 'rates', 'pricing', 'NS01', 'gst'],
  },
  {
    id: 'faq-export-excel',
    question: 'What does Export Center’s Excel workbook do?',
    answer:
      'Export builds a multi-tab .xlsx (Start Here, Billing Log, Year Summary, NS04-NS05 Approvals, Complex Cases, Decline Tracker, Management Summary) with dropdowns and totals — it replaces the old toolkit spreadsheet. ' +
      'Import reads recognised tabs back in (with a preview); unknown columns/sheets become custom fields/tables. Use Undo Excel import when offered to roll back the last import snapshot.',
    tags: ['export', 'excel', 'xlsx', 'toolkit', 'backup', 'import'],
  },
  {
    id: 'faq-export-center',
    question: 'What should I use in Export Center — Excel, JSON, or ZIP?',
    answer:
      'Excel workbook = day-to-day toolkit replacement (shareable tabs, import/merge). JSON / .accdata = portable app data without every attached letter blob. ' +
      'Full ZIP = data + every stored document (best for moving PCs or deep archive). Top-bar Save my data is the everyday .accdata habit; Export Center is for toolkit/Excel and full archives.',
    tags: ['export', 'excel', 'json', 'zip', 'accdata', 'backup'],
  },
  {
    id: 'faq-save-load',
    question: 'What is the difference between Save my data, IndexedDB autosave, and Export Center?',
    answer:
      'IndexedDB autosaves every edit in this browser (crash-safe) but does not clear the “unsaved” warning — that clears when you Save my data to a .accdata file. ' +
      'Load my data restores from .accdata/JSON. Export Center adds Excel toolkit export/import and optional full ZIP with documents.',
    tags: ['save', 'load', 'accdata', 'indexeddb', 'topbar', 'export'],
  },
  {
    id: 'faq-concurrent-tabs',
    question: 'Why does a yellow banner say another tab has the suite open?',
    answer:
      'Two browser tabs share the same IndexedDB. Last write wins — conflicting edits can overwrite each other. Close the extra tab and keep one open for editing.',
    tags: ['concurrent', 'tabs', 'warning', 'indexeddb'],
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
    id: 'faq-mail-reference',
    question: 'What is Mail Reference for?',
    answer:
      'An editable office cheat-sheet of ACC form codes and where each goes (email / CC / hand-off instructions), seeded from the 2024 Team Processes sheet. ' +
      'Search, add, edit, or Reset to 2024 defaults. It is reference only — not patient records and not sent anywhere.',
    tags: ['mail', 'reference', 'forms', 'routing'],
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
      'Autosave keeps you safe from browser crashes on this PC. A .accdata export (or Export Center Excel/JSON/ZIP) is what you need ' +
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
    id: 'faq-easter-eggs',
    question: 'How do I turn on disco cats, cute cursors, or the walking companion?',
    answer:
      'Open Settings (sidebar → Settings). The Fun / Easter eggs card is near the top, just under About. Toggle Dancing disco cats, pick a Mouse cursor style, and/or enable Walking companion (pick a character). ' +
      'All are off by default, decorative only, and never change patient or billing data. Motion gentles if your system prefers reduced motion. ' +
      'If you do not see that card, you are on an older zip/build — use a rebuilt dist that includes the Fun easter eggs commits. ' +
      'Shortcut: triple-click the teal sidebar “NS” badge (top-left) to toggle disco cats for this browser session (session toggle is separate from the Settings checkbox that stays on across launches).',
    tags: ['fun', 'easter', 'disco', 'cats', 'cursor', 'companion', 'NS'],
  },
  {
    id: 'faq-disco-ns',
    question: 'I triple-clicked “NS” and cats appeared — how do I turn that off?',
    answer:
      'Triple-clicking the sidebar NS mark toggles a session-only disco overlay. Click the disco panel’s off control, triple-click NS again, or turn off Dancing disco cats in Settings → Fun / Easter eggs ' +
      '(that Settings toggle is the persistent always-on preference).',
    tags: ['disco', 'NS', 'triple-click', 'fun', 'easter'],
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
