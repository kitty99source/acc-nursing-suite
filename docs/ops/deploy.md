# Deploy runbook (P7-004)

**Default (U-01):** static `dist/` folder on a mapped share (e.g. `I:\ACC-Suite\`).

## Build artifact

```bash
npm ci
npm test
npm run build
npm run verify-build
```

Ship the entire `dist/` directory including:

- `index.html` (single-file app)
- `eng.traineddata` (OCR)
- Windows launchers (`Start ACC Suite.cmd`, `launch.ps1`, …)
- `wfh/` scripts (folder watch)
- `office-config.example.json` (U-26 office template)

## Copy to share

1. Zip `dist/` or robocopy to the hospital share.
2. Users double-click **Start ACC Suite.cmd** (opens Edge/Chrome to `127.0.0.1`).
3. **Do not** require write access to the share — logs belong under `%USERPROFILE%\ACC-Suite\logs\` only (see `LAUNCHER_INCIDENT_REPORT.md`).

## Versioning

- Version and build date appear in Settings → About (from `package.json` via Vite `define`).
- Record release in `CHANGELOG.md`.

## Checksum (optional)

```bash
shasum -a 256 dist/index.html > dist/SHA256SUMS.txt
```

## Blocked on hospital input

- **MDM / Citrix packaging (U-01)** — IT must confirm install path and read-only share policy.
- **Branch protection / CI** — enable required checks on `main` when GitHub org allows.
