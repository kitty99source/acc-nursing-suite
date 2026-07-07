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

mkdirSync(DIST, { recursive: true });
mkdirSync(WFH_DIST, { recursive: true });

const launcherFiles = [
  'launcher-log.ps1',
  'launch.ps1',
  'Start ACC Suite.cmd',
  'portal-discover.ps1',
  'folder-watch.ps1',
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
    copyPs1WithBom(from, to);
  } else {
    copyFileSync(from, to);
  }
  console.log(`Copied ${name} → dist/`);
}

const requiredInDist = ['launcher-log.ps1', 'launch.ps1', 'portal-discover.ps1'];
for (const name of requiredInDist) {
  const p = join(DIST, name);
  if (!existsSync(p)) {
    console.error(`Build verification failed: ${p} missing from dist/`);
    process.exit(1);
  }
}
console.log('Verified launcher-log.ps1, launch.ps1, portal-discover.ps1 in dist/');

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
