#!/usr/bin/env node
/** Copy Windows/Mac launcher scripts and WFH tools into dist/ after build. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER_SRC = join(ROOT, 'scripts/launcher');
const WFH_SRC = join(ROOT, 'scripts/wfh');
const DIST = join(ROOT, 'dist');
const WFH_DIST = join(DIST, 'wfh');

/** PowerShell 5.1 requires UTF-8 BOM to parse non-ASCII; ensure BOM on every .ps1 copy. */
function copyPs1WithBom(from, to) {
  let text = readFileSync(from, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  writeFileSync(to, '\uFEFF' + text, 'utf8');
}

/** Hospital PCs use Windows PowerShell 5.1; keep launcher .ps1 ASCII-only (BOM still added). */
function assertPs1AsciiOnly(from) {
  let text = readFileSync(from, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) {
      const line = text.slice(0, i).split('\n').length;
      console.error(`Non-ASCII U+${code.toString(16).toUpperCase()} in ${from} near line ${line}`);
      process.exit(1);
    }
  }
}

function assertDistPs1HasBom(path) {
  const buf = readFileSync(path);
  if (buf.length < 3 || buf[0] !== 0xef || buf[1] !== 0xbb || buf[2] !== 0xbf) {
    console.error(`Build verification failed: ${path} missing UTF-8 BOM`);
    process.exit(1);
  }
}

function assertCmdNoPsRedirect(from) {
  const text = readFileSync(from, 'utf8');
  const bad = text.match(/^powershell[^\r\n]*>>[^\r\n]*$/im);
  if (bad) {
    console.error(`${from} must not redirect PowerShell output to bootstrap log (file lock with ps1 append)`);
    console.error(`  ${bad[0].trim()}`);
    process.exit(1);
  }
}

mkdirSync(DIST, { recursive: true });
mkdirSync(WFH_DIST, { recursive: true });

const launcherFiles = [
  'bootstrap-log.ps1',
  'mailbox-config.ps1',
  'launcher-log.ps1',
  'launch.ps1',
  'Start ACC Suite.cmd',
  'portal-discover.ps1',
  'folder-watch.ps1',
  'outlook-probe.ps1',
  'outlook-sync.ps1',
  'outlook-diagnose.ps1',
  'inbox-config.ps1',
  'open-inbox-folder.ps1',
  'Start ACC-Inbox Folder.cmd',
  'Start Folder Watch.cmd',
  'Start Email Probe.cmd',
  'Start Email Sync.cmd',
  'Start Email Backfill.cmd',
  'Start Email Diagnose.cmd',
  'Rename-AccInboxAttachments.ps1',
  'Start Rename Inbox Files.cmd',
  'Backfill-EmailDates.ps1',
  'Start Backfill Email Dates.cmd',
  'Optimize-StagingSidecars.ps1',
  'Start Optimize Staging.cmd',
  'Reindex-InboxHashes.ps1',
  'Start Reindex Inbox.cmd',
  'Start ACC Suite (recommended).cmd',
  'Start ACC Suite (quiet).cmd',
  'Start ACC Suite (quiet).vbs',
  'Start WFH Mode.cmd',
  'wfh-mode.ps1',
  'supervisor.ps1',
  'lifecycle.ps1',
  'Stop-AccSuiteForce.ps1',
  'Stop ACC District Nursing Suite (force).cmd',
  'Stop ACC District Nursing Suite (force).vbs',
  'Start Portal Discover.cmd',
  'Start Portal Discover.command',
  'README.txt',
  'TROUBLESHOOT.txt',
];

for (const name of launcherFiles) {
  const from = join(LAUNCHER_SRC, name);
  const to = join(DIST, name);
  if (!existsSync(from)) {
    console.error(`Missing launcher source: ${from}`);
    process.exit(1);
  }
  if (name.endsWith('.ps1')) {
    assertPs1AsciiOnly(from);
    copyPs1WithBom(from, to);
  } else {
    copyFileSync(from, to);
  }
  if (name.endsWith('.cmd')) {
    assertCmdNoPsRedirect(from);
  }
  console.log(`Copied ${name} → dist/`);
}

const requiredInDist = ['bootstrap-log.ps1', 'launcher-log.ps1', 'launch.ps1', 'portal-discover.ps1'];
for (const name of requiredInDist) {
  const p = join(DIST, name);
  if (!existsSync(p)) {
    console.error(`Build verification failed: ${p} missing from dist/`);
    process.exit(1);
  }
  if (name.endsWith('.ps1')) {
    assertDistPs1HasBom(p);
  }
}
console.log('Verified bootstrap-log.ps1, launcher-log.ps1, launch.ps1, portal-discover.ps1 in dist/ (UTF-8 BOM)');

for (const name of readdirSync(WFH_SRC)) {
  if (!name.endsWith('.mjs')) continue;
  const from = join(WFH_SRC, name);
  const to = join(WFH_DIST, name);
  copyFileSync(from, to);
  console.log(`Copied wfh/${name} → dist/wfh/`);
}

const templateSrc = join(ROOT, 'docs/templates/office-config.example.json');
const templateDist = join(DIST, 'office-config.example.json');
if (existsSync(templateSrc)) {
  copyFileSync(templateSrc, templateDist);
  console.log('Copied office-config.example.json → dist/');
}
