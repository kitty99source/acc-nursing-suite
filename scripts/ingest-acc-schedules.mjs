#!/usr/bin/env node
// ============================================================================
// Build-time generator: reads the REAL extracted ACC document text under
// docs/research/raw-text/ (see docs/research/acc-public-contract-sources-
// 2026-08.md for where those PDFs came from) and produces two runtime-fetched
// JSON assets under public/data/acc/ — NEITHER is `import`ed into the JS
// bundle (both together are ~1MB of real text/data; this app ships a single
// self-contained index.html via vite-plugin-singlefile, so inlining either
// would bloat every session's JS parse/execute cost whether or not that
// session ever opens Contracts or asks the AI assistant a narrative
// question). Same "large local asset, not inlined" pattern as
// scripts/copy-tesseract-assets.mjs / copy-pdf-worker.mjs:
//
//   1. public/data/acc/schedules.json — structured price-table rows, fetched
//      at runtime by lib/acc/scheduleData.ts.
//   2. public/data/acc/knowledge-chunks.json — the full chunked narrative
//      corpus, fetched at runtime by lib/ai/knowledgeCorpus.ts.
//
// Uses esbuild (already a transitive dependency of vite) to run the real
// TypeScript parsing/chunking modules directly, so this script is never a
// second, drifting reimplementation of scheduleParser.ts/knowledgeChunking.ts
// — it calls the exact same tested code the app + vitest suite use.
//
// Run manually via `node scripts/ingest-acc-schedules.mjs` after adding/
// updating a raw-text fixture. Not wired into `npm run build` (the generated
// files are committed, like other generated assets in this repo) — re-run and
// re-commit when the source documents are ingested/updated.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import Module, { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RAW_TEXT_DIR = path.join(ROOT, 'docs/research/raw-text');
const require = createRequire(import.meta.url);

// Registered once so a loaded module's own `require('./sibling')` (with no extension, e.g.
// nationalContracts.ts requiring './knownCodes') also resolves through this same TS-via-esbuild
// path, rather than only working for modules loaded directly by this script.
Module._extensions['.ts'] = function loadTsExtension(module, filename) {
  const src = fs.readFileSync(filename, 'utf-8');
  const { code } = transformSync(src, { loader: 'ts', format: 'cjs', sourcefile: filename });
  module._compile(code, filename);
};

function loadTsModule(relPath) {
  const absPath = path.join(ROOT, relPath);
  return require(absPath);
}


const scheduleParser = loadTsModule('src/lib/acc/scheduleParser.ts');
const knownCodes = loadTsModule('src/lib/acc/knownCodes.ts');
const sourceDocsMod = loadTsModule('src/lib/acc/sourceDocs.ts');
const chunking = loadTsModule('src/lib/ai/knowledgeChunking.ts');
// Reuses nationalContracts.ts's own core+non-core table-slicing logic, so this generator script
// is never a second, drifting reimplementation of how the Elective Surgery Service Schedule's two
// real price tables get combined.
const nationalContracts = loadTsModule('src/lib/acc/nationalContracts.ts');

function readRaw(id) {
  return fs.readFileSync(path.join(RAW_TEXT_DIR, `${id}.txt`), 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. Structured price tables -> src/lib/acc/generated/schedules.json
// ---------------------------------------------------------------------------

const nursingItems = nationalContracts.parseNursingText(readRaw('nursing-service-schedule'));
const alliedItems = nationalContracts.parseAlliedHealthText(readRaw('allied-health-services-service-schedule'));
const electiveItems = nationalContracts.parseElectiveSurgeryText(readRaw('elective-surgery-service-schedule'));
const cotrItems = scheduleParser.parseCotrRateSheet(
  readRaw('ACC1523-Specified-treatment-provider-costs'),
  knownCodes.COTR_ALL_CODES,
);

const schedulesOut = {
  generatedAt: new Date().toISOString(),
  schedules: [
    { sourceDocId: 'nursing-service-schedule', items: nursingItems },
    { sourceDocId: 'allied-health-services-service-schedule', items: alliedItems },
    { sourceDocId: 'elective-surgery-service-schedule', items: electiveItems },
    { sourceDocId: 'ACC1523-Specified-treatment-provider-costs', items: cotrItems },
  ],
};

const publicDataDirEarly = path.join(ROOT, 'public/data/acc');
fs.mkdirSync(publicDataDirEarly, { recursive: true });
fs.writeFileSync(path.join(publicDataDirEarly, 'schedules.json'), JSON.stringify(schedulesOut));

// ---------------------------------------------------------------------------
// 2. Narrative corpus -> public/data/acc/knowledge-chunks.json
// ---------------------------------------------------------------------------

const NARRATIVE_DOC_IDS = [
  'nurse-og',
  'elective-surgery-og',
  'health-contract-terms-conditions',
  'acc7909-working-together-cotr-providers',
  // The full structured-schedule documents ALSO get chunked for narrative RAG so a question about
  // a procedure/code outside the structured subset above can still surface real schedule text
  // (e.g. an Elective Surgery code outside the AFT/3DIMAGE structured subset).
  'nursing-service-schedule',
  'allied-health-services-service-schedule',
  'elective-surgery-service-schedule',
  'ACC1523-Specified-treatment-provider-costs',
  // Added 4 Aug 2026 — closing the §8 gap audit (review & appeal rights,
  // complaints, non-resident eligibility, weekly compensation, vocational
  // rehabilitation, Accredited Employer claims process, cultural/whānau
  // support, allied-health telehealth). See sourceDocs.ts for provenance.
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

let allChunks = [];
for (const id of NARRATIVE_DOC_IDS) {
  const raw = readRaw(id);
  const chunks = chunking.chunkDocumentText(id, raw);
  allChunks = allChunks.concat(chunks);
}

const knowledgeOut = { generatedAt: new Date().toISOString(), chunks: allChunks };
const publicDataDir = path.join(ROOT, 'public/data/acc');
fs.mkdirSync(publicDataDir, { recursive: true });
fs.writeFileSync(path.join(publicDataDir, 'knowledge-chunks.json'), JSON.stringify(knowledgeOut));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function sizeKb(p) {
  return (fs.statSync(p).size / 1024).toFixed(1);
}

console.log('--- ACC document ingestion summary ---');
console.log(`Nursing Service Schedule: ${nursingItems.length} codes (${nursingItems.filter((i) => i.price !== null).length} priced)`);
console.log(`Allied Health Service Schedule: ${alliedItems.length} codes (${alliedItems.filter((i) => i.price !== null).length} priced)`);
console.log(
  `Elective Surgery Service Schedule (FULL — Table 1 core + Table 2 non-core): ${electiveItems.length} codes (${electiveItems.filter((i) => i.price !== null).length} priced, ${electiveItems.filter((i) => i.actualCost).length} actual-cost)`,
);
console.log(`ACC1523 CoTR rate sheet: ${cotrItems.length} codes`);
console.log(
  `Total structured price rows: ${nursingItems.length + alliedItems.length + electiveItems.length + cotrItems.length}`,
);
console.log(`schedules.json: ${sizeKb(path.join(publicDataDirEarly, 'schedules.json'))} KB`);
console.log(`knowledge-chunks.json: ${allChunks.length} chunks, ${sizeKb(path.join(publicDataDir, 'knowledge-chunks.json'))} KB`);
console.log(`Narrative source docs chunked: ${NARRATIVE_DOC_IDS.join(', ')}`);
console.log(`Total registered source docs: ${sourceDocsMod.ACC_SOURCE_DOCS.length}`);
