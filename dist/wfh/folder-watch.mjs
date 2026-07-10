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
 * Default inbox: ~/ACC-Inbox (override with ACC_INBOX_PATH, ACC_INBOX env, office-config accInbox.inboxPath, or first arg)
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

function readOfficeInboxPath() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  if (!home) return null;
  const configPath = path.join(home, 'ACC-Suite', 'office-config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const inboxPath = cfg?.accInbox?.inboxPath;
    if (typeof inboxPath === 'string' && inboxPath.trim()) {
      return path.resolve(inboxPath.trim());
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveInboxDir(arg) {
  if (arg) return path.resolve(arg);
  if (process.env.ACC_INBOX_PATH?.trim()) return path.resolve(process.env.ACC_INBOX_PATH.trim());
  if (process.env.ACC_INBOX?.trim()) return path.resolve(process.env.ACC_INBOX.trim());
  const fromOffice = readOfficeInboxPath();
  if (fromOffice) return fromOffice;
  return path.resolve(DEFAULT_INBOX);
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

function sidecarFileStem(fileName) {
  const base = path.basename(fileName || 'attachment');
  const safe = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}

function sidecarPath(inbox, hash, fileName) {
  return path.join(inbox, STAGING_DIR, `${hash}_${sidecarFileStem(fileName)}.json`);
}

function alreadyStaged(inbox, hash, fileName) {
  return fs.existsSync(sidecarPath(inbox, hash, fileName));
}

function createSidecar({ filePath, hash, inbox }) {
  const fileName = path.basename(filePath);
  const id = crypto.randomUUID();
  const sidecar = {
    version: 1,
    item: {
      id,
      type: 'letter-import-pending',
      status: 'pending',
      source: 'folder',
      createdAt: Date.now(),
      severity: 'info',
      title: `Folder: ${fileName}`,
      summary: `Letter dropped in ACC-Inbox - awaiting HRQ review and letter parse.`,
      sourceFileName: fileName,
      sourceHash: hash,
      sourcePath: filePath,
      runId: `folder-watch-${new Date().toISOString().slice(0, 10)}`,
    },
  };
  // Sidecars stay LEAN (metadata only). Embedding the file as base64 made the
  // /_acc/staging list huge and slow (out-of-memory -> "bridge down"); the bytes
  // are resolved on demand by hash via /_acc/inbox-file instead.
  return sidecar;
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
  const leafName = path.basename(filePath);
  if (alreadyStaged(inbox, hash, leafName)) {
    const sidecarName = path.basename(sidecarPath(inbox, hash, leafName));
    console.log(
      `[skip] re-scan: identical bytes for ${leafName} already staged (.staging/${sidecarName}, SHA-256 ${hash.slice(0, 8)}…)`,
    );
    return;
  }

  const sidecar = createSidecar({ filePath, hash, inbox });
  const outPath = sidecarPath(inbox, hash, leafName);
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
