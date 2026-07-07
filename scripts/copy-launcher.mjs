#!/usr/bin/env node
/** Copy Windows/Mac launcher scripts and WFH tools into dist/ after build. */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER_SRC = join(ROOT, 'scripts/launcher');
const WFH_SRC = join(ROOT, 'scripts/wfh');
const DIST = join(ROOT, 'dist');
const WFH_DIST = join(DIST, 'wfh');

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
];

for (const name of launcherFiles) {
  const from = join(LAUNCHER_SRC, name);
  const to = join(DIST, name);
  if (!existsSync(from)) {
    console.error(`Missing launcher source: ${from}`);
    process.exit(1);
  }
  copyFileSync(from, to);
  console.log(`Copied ${name} → dist/`);
}

for (const name of readdirSync(WFH_SRC)) {
  if (!name.endsWith('.mjs')) continue;
  const from = join(WFH_SRC, name);
  const to = join(WFH_DIST, name);
  copyFileSync(from, to);
  console.log(`Copied wfh/${name} → dist/wfh/`);
}
