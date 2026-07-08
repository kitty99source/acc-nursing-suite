import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Mirror of folder-watch sidecar shape for integration smoke test. */
function createSidecar(fileName, hash) {
  return {
    version: 1,
    item: {
      id: crypto.randomUUID(),
      type: 'letter-import-pending',
      status: 'pending',
      source: 'folder',
      createdAt: Date.now(),
      severity: 'info',
      title: `Folder: ${fileName}`,
      summary: 'Test sidecar',
      sourceFileName: fileName,
      sourceHash: hash,
    },
  };
}

describe('folder-watch sidecar format', () => {
  it('writes valid staging sidecar JSON', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-inbox-'));
    const stagingDir = path.join(tmp, '.staging');
    fs.mkdirSync(stagingDir);
    const hash = crypto.createHash('sha256').update('fake-pdf').digest('hex');
    const sidecar = createSidecar('test.pdf', hash);
    const out = path.join(stagingDir, `${hash}_test.pdf.json`);
    fs.writeFileSync(out, JSON.stringify(sidecar));
    const loaded = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(loaded.version).toBe(1);
    expect(loaded.item.source).toBe('folder');
    expect(loaded.item.sourceHash).toBe(hash);
    fs.rmSync(tmp, { recursive: true });
  });
});
