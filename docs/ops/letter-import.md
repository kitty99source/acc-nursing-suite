# Letter import operations runbook (P7-002)

## When OCR fails on a scanned PDF

1. **Retry once** — first OCR run loads the offline engine (`eng.traineddata`); wait for the “Scanned PDF detected” callout to finish.
2. **Attach document only** — in the import error modal, choose **Attach doc only** to store the PDF on the claim without parsing.
3. **Manual entry** — open the claim in Patients, add approvals/declines manually, and attach the PDF from Claim Documents.
4. **Folder watch / HRQ** — drop the PDF in `ACC-Inbox/`; review in **Review Queue** before sign-off (never auto-commits in production).

## Corrupt or unreadable PDF

- Use **Try another file** or **Attach doc only** from the error state (P5-003 — modal never goes blank).
- Do not rely on filename alone for duplicate detection — hash + size is used (P5-010).

## Work PC vs home

- Real letter corpus regression (P5-001) and Outlook COM bridge (P8-017) require the hospital work PC and anonymised PDFs (U-05).

## Escalation

- Export **Settings → Download diagnostics** and the `.accdata` backup before IT wipe.
- See `change-requests/RUNBOOK.md` for IDB restore.
