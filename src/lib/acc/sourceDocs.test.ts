import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACC_SOURCE_DOCS, sourceDocById } from './sourceDocs';

// Regression guard for the 4 Aug 2026 knowledge-base gap-closure ingestion
// (docs/research/acc-public-contract-sources-2026-08.md §8): every entry
// registered here must actually have a raw-text fixture on disk, and ids
// must stay unique/stable since knowledge chunks reference them by id.
const RAW_TEXT_DIR = path.join(__dirname, '../../../docs/research/raw-text');

describe('ACC_SOURCE_DOCS registry', () => {
  it('has no duplicate ids', () => {
    const ids = ACC_SOURCE_DOCS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a real, non-empty url and a raw-text fixture on disk', () => {
    for (const doc of ACC_SOURCE_DOCS) {
      expect(doc.url).toMatch(/^https:\/\//);
      const rawPath = path.join(RAW_TEXT_DIR, doc.rawTextFile);
      expect(fs.existsSync(rawPath), `missing raw-text fixture for ${doc.id}: ${rawPath}`).toBe(true);
    }
  });

  it('includes the gap-closure documents added for review/appeal, complaints, non-resident eligibility, weekly compensation, vocational rehabilitation, telehealth, cultural support, and home modifications', () => {
    const expectedIds = [
      'acc-claimants-rights-notice',
      'code-of-health-disability-consumers-rights',
      'supporting-injured-international-visitors',
      'weekly-compensation-quick-guide',
      'vrs-og',
      'allied-health-services-operational-guidelines',
      'acc8331-telehealth-guide',
      'acc-te-whanau-maori-guidance',
      'housing-modification-services-og',
    ];
    for (const id of expectedIds) {
      expect(sourceDocById(id), `expected source doc ${id} to be registered`).toBeDefined();
    }
  });

  it('includes the §6/§7 travel and emergency-transport documents (URL + on-disk fixture)', () => {
    const expectedIds = [
      'ancillary-services-regulations-2002',
      'accident-services-transport-accommodation',
      'client-travel-and-transport',
      'travel-policy-for-providers',
      'ambulance-road-and-air-service',
    ];
    for (const id of expectedIds) {
      const doc = sourceDocById(id);
      expect(doc, `expected source doc ${id} to be registered`).toBeDefined();
      expect(doc!.url).toMatch(/^https:\/\//);
      const rawPath = path.join(RAW_TEXT_DIR, doc!.rawTextFile);
      expect(fs.existsSync(rawPath), `missing raw-text fixture for ${id}`).toBe(true);
      const text = fs.readFileSync(rawPath, 'utf8');
      expect(text.length).toBeGreaterThan(200);
    }
  });
});
