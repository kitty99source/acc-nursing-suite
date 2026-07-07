#!/usr/bin/env node
/**
 * P8-2b — Portal selector discovery via CDP attach (no Playwright).
 *
 * Connects to an already-logged-in Chrome/Edge session (Citrix VPN + manual SSO
 * done by you first). Dumps page metadata, links, and optional ACC-path crawl.
 *
 * Usage:
 *   node scripts/wfh/portal-discover.mjs
 *   node scripts/wfh/portal-discover.mjs --attach --crawl
 *   node scripts/wfh/portal-discover.mjs --cdp http://127.0.0.1:9222 --out ~/ACC-Suite/portal-map.json
 *
 * Double-click launcher: dist/Start Portal Discover.cmd (Windows)
 *
 * Never store portal passwords in this script or output JSON.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToTarget } from './cdp-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CDP = process.env.PORTAL_CDP_URL ?? 'http://127.0.0.1:9222';
const DEFAULT_OUT = path.join(os.homedir(), 'ACC-Suite', 'portal-map.json');
const CRAWL_KEYWORDS = ['acc', 'district nursing', 'dhb-wide'];
const FROM_LAUNCHER = process.env.PORTAL_DISCOVER_LAUNCHER === '1';

function parseArgs(argv) {
  const opts = {
    cdp: DEFAULT_CDP,
    out: DEFAULT_OUT,
    crawl: FROM_LAUNCHER,
    attach: FROM_LAUNCHER,
    maxDepth: 2,
    maxPages: 12,
    summary: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--crawl') opts.crawl = true;
    else if (arg === '--attach') opts.attach = true;
    else if (arg === '--no-summary') opts.summary = false;
    else if (arg === '--cdp' && argv[i + 1]) opts.cdp = argv[++i];
    else if (arg === '--out' && argv[i + 1]) opts.out = expandHome(argv[++i]);
    else if (arg === '--max-depth' && argv[i + 1]) opts.maxDepth = Number(argv[++i]) || 2;
    else if (arg === '--max-pages' && argv[i + 1]) opts.maxPages = Number(argv[++i]) || 12;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node portal-discover.mjs [--attach] [--crawl] [--cdp URL] [--out path] [--no-summary]`,
      );
      process.exit(0);
    }
  }
  opts.out = path.resolve(opts.out);
  return opts;
}

function expandHome(p) {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function redactSensitive(text) {
  if (!text) return text;
  return text
    .replace(/\b[A-Z]{3}\d{4}\b/g, '[NHI]')
    .replace(/\b\d{11}\b/g, '[CLAIM]')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, '[DATE]');
}

function matchesKeyword(text) {
  const lower = (text ?? '').toLowerCase();
  return CRAWL_KEYWORDS.some((k) => lower.includes(k));
}

const LINKS_JS = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('a[href], button, [role="link"], [role="button"]')) {
    const text = (el.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const href = el.getAttribute('href') ?? '';
    const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
    if (!text && !href) continue;
    let selector = '';
    if (el.id) selector = '#' + el.id;
    else if (el.getAttribute('data-testid')) selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
    else if (el.getAttribute('aria-label')) selector = '[aria-label="' + el.getAttribute('aria-label') + '"]';
    out.push({ text: text.slice(0, 200), href, role, selector });
  }
  return out.slice(0, 200);
})()`;

const HEADINGS_JS = `(() =>
  [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
    .map((el) => (el.textContent ?? '').replace(/\\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30))()`;

const BREADCRUMBS_JS = `(() => {
  const nav = document.querySelector('[aria-label*="breadcrumb" i], nav.breadcrumb, .breadcrumb');
  if (!nav) return [];
  return [...nav.querySelectorAll('a, span, li')]
    .map((el) => (el.textContent ?? '').replace(/\\s+/g, ' ').trim())
    .filter(Boolean);
})()`;

const CANDIDATES_JS = `(() => {
  const els = [...document.querySelectorAll('a[href], [role="link"]')];
  return els
    .map((el) => ({
      text: (el.textContent ?? '').replace(/\\s+/g, ' ').trim(),
      href: el.getAttribute('href') ?? '',
    }))
    .filter((l) => l.text || l.href);
})()`;

function pruneA11y(node, depth = 0) {
  if (!node || depth > 6) return null;
  const out = { role: node.role, name: redactSensitive(node.name) };
  if (node.value) out.value = redactSensitive(String(node.value));
  if (node.children?.length) {
    out.children = node.children
      .map((c) => pruneA11y(c, depth + 1))
      .filter(Boolean)
      .slice(0, 40);
  }
  return out;
}

/** @param {import('./cdp-client.mjs').CdpSession} session */
async function collectPageSnapshot(session, depth) {
  const url = redactSensitive(await session.getUrl());
  const title = redactSensitive(await session.getTitle());

  const links = /** @type {Array<{text:string,href:string,role:string,selector:string}>} */ (
    await session.evaluate(LINKS_JS)
  );
  const headings = /** @type {string[]} */ (await session.evaluate(HEADINGS_JS));
  const breadcrumbs = /** @type {string[]} */ (await session.evaluate(BREADCRUMBS_JS));

  let accessibility = null;
  try {
    const snap = await session.accessibilitySnapshot();
    accessibility = snap?.children ? pruneA11y(snap) : snap;
  } catch {
    accessibility = { error: 'accessibility snapshot unavailable' };
  }

  return {
    depth,
    url,
    title,
    headings: headings.map(redactSensitive),
    breadcrumbs: breadcrumbs.map(redactSensitive),
    links: (links ?? []).map((l) => ({ ...l, text: redactSensitive(l.text) })),
    accessibility,
    capturedAt: new Date().toISOString(),
  };
}

/** @param {import('./cdp-client.mjs').CdpSession} session */
async function followInterestingLinks(session, opts, visited, pages, depth) {
  if (depth >= opts.maxDepth || pages.length >= opts.maxPages) return;

  const candidates = /** @type {Array<{text:string,href:string}>} */ (await session.evaluate(CANDIDATES_JS));
  const baseUrl = await session.getUrl();

  for (const link of candidates ?? []) {
    if (pages.length >= opts.maxPages) break;
    if (!matchesKeyword(link.text) && !matchesKeyword(link.href)) continue;

    let abs;
    try {
      abs = new URL(link.href, baseUrl).href;
    } catch {
      continue;
    }
    if (visited.has(abs)) continue;
    visited.add(abs);

    try {
      await session.navigate(abs);
      const snap = await collectPageSnapshot(session, depth + 1);
      pages.push(snap);
      console.log(`[crawl] depth=${depth + 1} ${snap.title}`);
      await followInterestingLinks(session, opts, visited, pages, depth + 1);
    } catch (err) {
      console.warn(`[warn] could not follow "${link.text}": ${err.message}`);
    }
  }
}

function writeSummaryHtml(map, outPath) {
  const summaryPath = path.join(path.dirname(outPath), 'portal-summary.html');
  const rows = map.pages
    .map(
      (p, i) => `
    <section class="page">
      <h2>${i + 1}. ${escapeHtml(p.title || '(no title)')}</h2>
      <p class="meta"><strong>URL:</strong> ${escapeHtml(p.url)}</p>
      <p class="meta"><strong>Depth:</strong> ${p.depth} · <strong>Links:</strong> ${p.links?.length ?? 0}</p>
      ${p.headings?.length ? `<p><strong>Headings:</strong> ${escapeHtml(p.headings.join(' · '))}</p>` : ''}
      ${
        p.links?.length
          ? `<details><summary>Sample links (${Math.min(p.links.length, 15)} shown)</summary><ul>${p.links
              .slice(0, 15)
              .map((l) => `<li>${escapeHtml(l.text || l.href)} <code>${escapeHtml(l.href)}</code></li>`)
              .join('')}</ul></details>`
          : ''
      }
    </section>`,
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ACC Portal Discovery — ${map.pageCount} page(s)</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { color: #0b5; }
    .page { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .meta { color: #555; font-size: 0.9rem; }
    code { font-size: 0.8rem; word-break: break-all; }
    .note { background: #fff8e6; padding: 0.75rem; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>ACC Portal Discovery</h1>
  <p class="note">Review and redact patient names or identifiers before sharing this file.</p>
  <p><strong>Pages captured:</strong> ${map.pageCount} · <strong>Crawl:</strong> ${map.crawlEnabled ? 'yes' : 'no'}</p>
  <p><strong>JSON:</strong> <code>${escapeHtml(outPath)}</code></p>
  ${rows}
</body>
</html>`;

  fs.writeFileSync(summaryPath, html, 'utf8');
  console.log(`Wrote ${summaryPath}`);
  return summaryPath;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });

  if (!opts.attach) {
    console.log('Tip: use --attach (default from Start Portal Discover.cmd) to connect to your open browser.');
  }

  console.log(`Connecting to CDP at ${opts.cdp} …`);
  let session;
  try {
    session = await connectToTarget(opts.cdp);
  } catch (err) {
    console.error(`CDP connect failed: ${err.message}`);
    console.error('Launch Chrome/Edge with remote debugging, e.g.:');
    console.error('  msedge.exe --remote-debugging-port=9222');
    process.exit(1);
  }

  const seedUrl = await session.getUrl();
  const visited = new Set([seedUrl]);
  const pages = [];

  try {
    const snap = await collectPageSnapshot(session, 0);
    pages.push(snap);
    console.log(`[snap] depth=0 ${snap.title} — ${snap.url}`);
    if (opts.crawl) {
      await followInterestingLinks(session, opts, visited, pages, 0);
    }
  } catch (err) {
    console.warn(`[warn] snapshot failed: ${err.message}`);
  } finally {
    session.disconnect();
  }

  if (!pages.length) {
    console.error('No pages captured. Open the portal report page in the debug browser and try again.');
    process.exit(1);
  }

  const map = {
    version: 1,
    generator: 'portal-discover.mjs',
    cdpUrl: opts.cdp,
    crawlEnabled: opts.crawl,
    pageCount: pages.length,
    pages,
    notes: [
      'Review portal-map.json before commit — redact any patient names or identifiers.',
      'Do not store portal credentials in this file.',
    ],
  };

  fs.writeFileSync(opts.out, JSON.stringify(map, null, 2), 'utf8');
  console.log(`Wrote ${opts.out} (${pages.length} page(s))`);

  if (opts.summary) {
    writeSummaryHtml(map, opts.out);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
