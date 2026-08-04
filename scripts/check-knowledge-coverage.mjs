// ============================================================================
// Lightweight "coverage self-check" for the AI chat assistant's ingested
// knowledge base (public/data/acc/knowledge-chunks.json). Sketched per the
// proactive gap-audit in docs/research/acc-public-contract-sources-2026-08.md
// §8, as a small, clearly-scoped way to catch future zero-coverage topics
// BEFORE an owner hits a fabricated answer in real use, rather than only
// finding gaps reactively after a bad answer (as happened for §6 travel
// policy and §7 ambulance/emergency-transport).
//
// This is deliberately NOT a new retrieval system — it just re-uses the same
// keyword-search-over-chunk-text technique already used by hand during both
// prior bug-fix passes, wrapped in a repeatable script with a topic list that
// can grow over time. Run it whenever a new use case is about to be pointed
// at the assistant, or periodically (e.g. before a release), not on every
// commit.
//
// Usage: node scripts/check-knowledge-coverage.mjs
// Exit code is always 0 (informational only) — this is a report, not a gate.
// ============================================================================

import fs from 'node:fs';
import { join } from 'node:path';

const CHUNKS_PATH = join(process.cwd(), 'public/data/acc/knowledge-chunks.json');

// Add a topic here whenever a new real-world use case is about to be pointed
// at the assistant, or a new source document type is being considered for
// ingestion. Keep `terms` short and specific — this is keyword overlap, not
// semantic search, so overly generic terms (e.g. "claim") will always
// "find" something without it being real coverage.
const TOPICS = [
  { name: 'Patient travel & accommodation policy', terms: ['travel policy', 'accommodation assistance', 'mileage'] },
  { name: 'Emergency / ambulance transport criteria', terms: ['ambulance', 'emergency transport', 'triage'] },
  { name: 'Client review & appeal rights (declined claims)', terms: ['section 135', 'review right', 'appeal', 'district court', 'reconsideration'] },
  { name: 'Client complaints process', terms: ['code of rights', 'complaint about', 'consumer rights'] },
  { name: 'Cover decision / eligibility (general)', terms: ['cover decision', 'eligibility criteria', 'cover for'] },
  { name: 'Weekly compensation policy', terms: ['weekly compensation', 'loss of earnings', 'incapacity'] },
  { name: 'Vocational rehabilitation', terms: ['vocational rehabilitation', 'return to work'] },
  { name: 'Sensitive claims', terms: ['sensitive claim'] },
  { name: 'Independence allowance / impairment', terms: ['independence allowance', 'whole person impairment'] },
  { name: 'Home modifications', terms: ['home modification', 'housing modification'] },
  { name: 'Non-resident / historical claim eligibility', terms: ['non-resident', 'residency', 'historical claim'] },
  { name: 'Accredited employer claims process', terms: ['accredited employer'] },
  { name: 'Telehealth eligibility (allied health)', terms: ['telehealth'] },
  { name: 'Cultural / whānau support provisions', terms: ['whānau', 'whanau', 'cultural need'] },
];

function loadChunks() {
  const raw = fs.readFileSync(CHUNKS_PATH, 'utf8');
  return JSON.parse(raw).chunks;
}

function countMatches(chunks, term) {
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return chunks.filter((c) => re.test(c.text)).length;
}

function main() {
  const chunks = loadChunks();
  console.log(`Checking ${TOPICS.length} topics against ${chunks.length} ingested chunks...\n`);

  const zero = [];
  const thin = [];

  for (const topic of TOPICS) {
    const counts = topic.terms.map((t) => ({ term: t, count: countMatches(chunks, t) }));
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    const detail = counts.map((c) => `${c.term}=${c.count}`).join(', ');
    console.log(`${total === 0 ? '[ZERO]  ' : total < 5 ? '[THIN]  ' : '[OK]    '}${topic.name} (${detail})`);
    if (total === 0) zero.push(topic.name);
    else if (total < 5) thin.push(topic.name);
  }

  console.log('\n--- Summary ---');
  console.log(`Zero-coverage topics: ${zero.length ? zero.join('; ') : 'none'}`);
  console.log(`Thin-coverage topics (<5 matching chunks): ${thin.length ? thin.join('; ') : 'none'}`);
  console.log(
    '\nZero/thin here means "no ingested document ever mentions this" — treat as a candidate for ' +
      'either real ingestion research (see acc-public-contract-sources-2026-08.md methodology) or an ' +
      'explicit note that the assistant should say it does not know, NOT as something to fix by tuning ' +
      'retrieval alone.',
  );
}

main();
