#!/usr/bin/env node
/**
 * P8-003 — Folder watch ingress (Phase 0).
 *
 * Watches ACC-Inbox/ for new PDFs and writes staging sidecar JSON to
 * ACC-Inbox/.staging/ — never touches live AppData. Import sidecars via
 * Settings → Staging import (or future HRQ module).
 *
 * Usage:
 *   node scripts/wfh/folder-watch.mjs [inboxDir]
 *   npm run wfh:folder-watch
 *
 * Default inbox: ~/ACC-Inbox (override with ACC_INBOX env or first arg)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_INBOX = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
  'ACC-Inbox',
);
const PROCESSED_DIR = 'processed';
const STAGING_DIR = '.staging';
const SUPPORTED_EXT = new Set(['.pdf', '.docx']);

function resolveInboxDir(arg) {
  return path.resolve(arg ?? process.env.ACC_INBOX ?? DEFAULT_INBOX);
}

function isAutomationPaused(inbox) {
  if (process.env.ACC_AUTOMATION_PAUSED === '1') return true;
  const flag = path.join(inbox, '.automation-paused');
  return fs.existsSync(flag);
}

function ensureDirs(inbox) {
  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(path.join(inbox, PROCESSED_DIR), { recursive: true });
  fs.mkdirSync(path.join(inbox, STAGING_DIR), { recursive: true });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sidecarPath(inbox, hash) {
  return path.join(inbox, STAGING_DIR, `${hash}.json`);
}

function alreadyStaged(inbox, hash) {
  return fs.existsSync(sidecarPath(inbox, hash));
}

function createSidecar({ filePath, hash, inbox }) {
  const fileName = path.basename(filePath);
  const id = crypto.randomUUID();
  return {
    version: 1,
    item: {
      id,
      type: 'letter-import-pending',
      status: 'pending',
      source: 'folder',
      createdAt: Date.now(),
      severity: 'info',
      title: `Folder: ${fileName}`,
      summary: `Letter dropped in ACC-Inbox — awaiting HRQ review and letter parse.`,
      sourceFileName: fileName,
      sourceHash: hash,
      sourcePath: filePath,
      runId: `folder-watch-${new Date().toISOString().slice(0, 10)}`,
    },
  };
}

function processPdf(inbox, filePath) {
  if (isAutomationPaused(inbox)) {
    console.log('[paused] automation hold — skipping', path.basename(filePath));
    return;
  }
  if (!fs.existsSync(filePath)) return;
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) return;

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return;
  }
  if (!stat.isFile() || stat.size === 0) return;

  const hash = sha256File(filePath);
  if (alreadyStaged(inbox, hash)) {
    console.log(`[skip] duplicate hash ${hash.slice(0, 8)}… ${path.basename(filePath)}`);
    return;
  }

  const sidecar = createSidecar({ filePath, hash, inbox });
  const outPath = sidecarPath(inbox, hash);
  fs.writeFileSync(outPath, JSON.stringify(sidecar, null, 2), 'utf8');

  const dest = path.join(inbox, PROCESSED_DIR, path.basename(filePath));
  try {
    fs.renameSync(filePath, dest);
  } catch (err) {
    console.warn(`[warn] could not move to processed/: ${err.message}`);
  }

  console.log(`[staged] ${path.basename(filePath)} → ${path.relative(inbox, outPath)}`);
}

function scanExisting(inbox) {
  for (const name of fs.readdirSync(inbox)) {
    if (name.startsWith('.') || name === PROCESSED_DIR) continue;
    const full = path.join(inbox, name);
    try {
      if (fs.statSync(full).isFile()) processPdf(inbox, full);
    } catch {
      /* ignore */
    }
  }
}

function watch(inbox) {
  ensureDirs(inbox);
  if (isAutomationPaused(inbox)) {
    console.log(`[paused] ${inbox} — create .automation-paused or unset ACC_AUTOMATION_PAUSED to resume`);
  }
  console.log(`Watching ${inbox} for PDF/Word drops (Ctrl+C to stop)`);
  scanExisting(inbox);

  fs.watch(inbox, { persistent: true }, (_event, filename) => {
    if (!filename || filename.startsWith('.')) return;
    const full = path.join(inbox, filename);
    setTimeout(() => processPdf(inbox, full), 300);
  });
}

const inbox = resolveInboxDir(process.argv[2]);
watch(inbox);
