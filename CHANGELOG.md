# Changelog

All notable releases of ACC District Nursing Admin Suite.

## [1.0.0] — 2026-07-08

### Production foundation (P0–P3, P6)

- Data integrity: corrupt IDB recovery, save model clarity, backup reminders, audit stub, schema migrations, backup manifest checksums.
- Performance: compliance cache, incremental scan, stress CI gates, virtualized Billing/Approvals/Declines tables.
- Reliability: global error boundary, autosave error banner, Excel import rollback.

### Letter import (P5)

- Full import UX: confirm/success/error flows, compliance routing, duplicate hash guard, document kinds, OCR callout, billing hints, global drag-drop, import history in Settings.

### SUPER WFH Phase 0 (P8.0)

- Human Review Queue, folder-watch ingress, batch approve with name list, ACC Inbox stub panel, automation pause switch.

### Operations (P7)

- RUNBOOK, letter-import ops doc, deploy doc, UAT checklist, diagnostics export, office config template (U-26).

### Security (partial P4)

- Display name for audit, session idle warning, concurrent tab banner, export audit logging. Full RBAC and encryption policy blocked on hospital inputs.
