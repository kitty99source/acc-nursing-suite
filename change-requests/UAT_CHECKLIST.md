# UAT checklist (P7-005)

Sign-off columns: **Tester** | **Date** | **Pass/Fail** | **Notes**

| ID | Journey | Role | Tester | Date | Pass | Notes |
|----|---------|------|--------|------|------|-------|
| J-01 | Approval full save (Approvals) | Admin | | | | |
| J-01a | Prefill new patient | Clerk | | | | |
| J-01b | Prefill new claim | Clerk | | | | |
| J-02 | Corrupt PDF error | Admin | | | | |
| J-03 | Dirty save model | Admin | | | | |
| J-04 | beforeunload | Admin | | | | |
| J-05 | Backup reminder | Admin | | | | |
| J-06 | No auto-commit George | Admin | | | | |
| J-07 | Dashboard queue cap | Admin | | | | |
| J-08 | Compliance pagination | Admin | | | | |
| J-09 | Billing virtual scroll | Admin | | | | |
| J-10 | Approvals historical | Clerk | | | | |
| J-11 | Declines scale + Open patient | Clerk | | | | |
| J-12 | Modal layout 1280×720 | Admin | | | | |
| J-13 | Mobile 375px | Admin | | | | |
| J-14 | Scanned OCR | Admin | | | | |
| J-15 | Compliance routing | Admin | | | | |
| J-16 | Corrupt IDB | IT | | | | |
| J-17 | Corrupt .accdata | IT | | | | |
| J-18 | Backup round-trip | IT | | | | |
| J-19 | Error boundary | Dev | | | | |
| J-20 | Encryption lifecycle | IT | | | | Skip if encryption off |
| J-21 | Concurrent tabs | Admin | | | | |
| J-22 | Duplicate letter | Admin | | | | |
| J-23 | Drag-drop global import | Clerk | | | | |
| J-24 | Stale remittance queue | Clerk | | | | |
| J-25 | HRQ sign-off | Admin | | | | |
| J-26 | Batch approve HRQ | Admin | | | | |
| J-27 | ACC Inbox stub | Admin | | | | Stub until P8-017 |

**Release gate:** zero P0 regressions from `MASTER_ROADMAP.md` §6.
