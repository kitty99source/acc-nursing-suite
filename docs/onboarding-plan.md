# District Nursing Admin Suite — first-run onboarding plan

Accurate as of 2026-07-27. Ported from Remittance Tracker progressive onboarding
(`docs/onboarding-plan.md` in ACC-RemittanceTracker tip `7ca0189`).

## Problem

After load, the app auto-opened the **Help Center** (`xl` modal) with a long Guide and FAQ.
Shared feedback across suites: a huge FAQ wall on day one is bad.

## Goals

- Progressive disclosure: slim Welcome once; dismissible Getting started checklist (≤3 items).
- Deep help opt-in only (Top bar Help / Settings / Helper Mode).
- Offline-first; synthetic samples OK.
- **Do not** change Windows launch / supervisor / `.vbs` / `launch.ps1`.

## Persona

Single admin coworker role (no manager/staff split). First jobs: Review Queue (HRQ) accept →
Patients / Approvals (NS04/NS05) → ACC Inbox sync or letter import for real work.

## Journey

```
1. Launch — unchanged
2. WELCOME (md modal, once)
     • What it is (1 sentence)
     • Demo data loaded (or empty path)
     • Primary: Explore the demo  |  Secondary: Clear sample & import / Open Review
     • Footer: Open the guide (opt-in Help)
3. Dashboard — Getting started checklist (dismissible)
       a. Open Review Queue (accept ACC letters)
       b. Check Patients & Approvals (NS04/NS05)
       c. Ready for real letters? Clear sample → ACC Inbox / drop letter
4. Help Center / FAQ — never auto-opened
```

## Progressive disclosure

| Surface | First-run | Returning |
|---|---|---|
| Help Center Guide + FAQ | **Never auto-open** | Opt-in only |
| Welcome modal | Once (`hasSeenWelcomeGuide`) | Off |
| Getting started card | Until dismissed or replay | Off if dismissed |
| Dashboard assumption banner stack | Hidden while checklist visible; suppressed while Welcome open | Normal |
| Backup reminder | Deferred until Welcome dismissed | Normal |

## Settings

- Settings → Help: “Open instruction guide” + **Replay getting started**
  (resets `gettingStartedDismissed` only — does not re-force Welcome modal).

## Upgrade path

If `hasSeenWelcomeGuide` is already true and `gettingStartedDismissed` is absent from saved
settings, `normalizeData` treats the checklist as dismissed so returning users are not
re-onboarded.

## Out of scope

- Launch / supervisor changes.
- Shared npm package across suites.
- Rewriting all FAQ copy.
