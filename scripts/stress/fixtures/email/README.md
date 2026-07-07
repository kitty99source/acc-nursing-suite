# Email corpus fixtures (stress / parser tests)

Synthetic and redacted samples for P8 email ingress development. **No real PHI** — patient name `Gilbert Gandor` confirmed fake by corpus provider (2026-07-08).

| File | Purpose |
|------|---------|
| `acc-approval-sample.eml` | Synthetic ACC approval email: From `Bec.Williams@acc.co.nz`, subject with Claim/ACCID tokens, PDF attachment |
| `email-corpus-notes.eml` | Redacted notes email (sender addresses + subject pattern only) |
| `nursing-services-processes.pdf` | Internal ACC district nursing process doc (reference PDF, not a patient letter) |
| `acc-email-screenshot-*.png` | Portal navigation screenshots (Health & BI Reports → ACC reports) |
| `approval-template.docx` | ACC approval letter Word template (same sample data as PDF fixture — P8-020) |

**Not included:** real mailbox addresses, passwords, or decline-letter samples (still needed — checklist B-05, B-07).
