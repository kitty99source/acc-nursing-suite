#!/usr/bin/env node
/**
 * Serve built dist/ on http://127.0.0.1:8765 (Mac/Linux/Windows with Node).
 * Fallback: python3 -m http.server if Node http fails.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PREFERRED = 8765;
const MAX_PORT = 8800;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.traineddata': 'application/octet-stream',
};

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { shell: true, detached: true, stdio: 'ignore' }).unref();
}

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const path = req.url === '/' || !req.url ? '/index.html' : req.url.split('?')[0];
      const file = join(DIST, path.replace(/^\//, ''));
      if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const body = readFileSync(file);
      const type = MIME[extname(file)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/index.html missing — run npm run build first.');
    process.exit(1);
  }

  let server;
  let port = PREFERRED;
  for (; port <= MAX_PORT; port++) {
    try {
      server = await tryListen(port);
      break;
    } catch {
      // port busy
    }
  }
  if (!server) {
    console.error('Could not bind 127.0.0.1 — ports', PREFERRED, '–', MAX_PORT, 'busy.');
    process.exit(1);
  }

  const url = `http://127.0.0.1:${port}/`;
  console.log('\n  ACC District Nursing Admin Suite');
  console.log('  --------------------------------');
  console.log(`  Serving locally at: ${url}`);
  console.log('  Keep this terminal open while you use the app.\n');
  openBrowser(url);

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
