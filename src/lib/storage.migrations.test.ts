import { describe, it, expect } from 'vitest';
import { deserialize, serialize, FILE_FORMAT } from './storage';
import { DEFAULT_SETTINGS } from '../types';
import type { AppData } from '../types';

function v1Envelope(): string {
  const data: AppData = {
    schemaVersion: 1,
    patients: [],
    claims: [],
    serviceLines: [],
    approvals: [],
    invoiceLines: [],
    complexCases: [],
    declines: [],
    settings: { ...DEFAULT_SETTINGS },
    documents: [],
    memos: [],
  };
  return JSON.stringify({ format: FILE_FORMAT, version: 1, encrypted: false, data });
}

describe('storage migrations', () => {
  it('migrates v1 accdata envelope on deserialize', async () => {
    const loaded = await deserialize(v1Envelope());
    expect(loaded.schemaVersion).toBe(4);
    expect(loaded.importHistory).toEqual([]);
    expect(loaded.memos).toEqual([]);
  });

  it('serializes at current FILE_VERSION', async () => {
    const data = await deserialize(v1Envelope());
    const text = await serialize(data);
    const env = JSON.parse(text) as { version: number };
    expect(env.version).toBe(4);
  });
});
