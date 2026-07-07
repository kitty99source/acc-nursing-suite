/**
 * Minimal Chrome DevTools Protocol client — Node built-ins only (no Playwright).
 * Connects to an existing Chrome/Edge session on --remote-debugging-port.
 */

import crypto from 'node:crypto';
import net from 'node:net';

/** @typedef {{ id: string, type: string, url: string, title: string, webSocketDebuggerUrl: string }} CdpTarget */

/**
 * @param {string} cdpBase e.g. http://127.0.0.1:9222
 * @returns {Promise<CdpTarget[]>}
 */
export async function listTargets(cdpBase) {
  const res = await fetch(`${cdpBase.replace(/\/$/, '')}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list failed: HTTP ${res.status}`);
  return /** @type {CdpTarget[]} */ (await res.json());
}

/**
 * Pick the best open tab for portal discovery.
 * @param {CdpTarget[]} targets
 */
export function pickPortalTab(targets) {
  const pages = targets.filter(
    (t) =>
      t.type === 'page' &&
      t.webSocketDebuggerUrl &&
      t.url &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('edge://') &&
      !t.url.startsWith('devtools://'),
  );
  const acc = pages.find((t) => /acc|msreport|biprd/i.test(t.url + t.title));
  return acc ?? pages[0] ?? null;
}

/**
 * Low-level WebSocket (RFC 6455) over TCP — works on Node 18+ without deps.
 */
class RawWebSocket {
  /** @param {string} url ws://127.0.0.1:9222/devtools/page/... */
  constructor(url) {
    this.url = url;
    /** @type {net.Socket | null} */
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    /** @type {((data: Buffer) => void) | null} */
    this.onFrame = null;
    /** @type {((err: Error) => void) | null} */
    this.onError = null;
    /** @type {(() => void) | null} */
    this.onClose = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const u = new URL(this.url);
      const key = crypto.randomBytes(16).toString('base64');
      const host = u.hostname;
      const port = Number(u.port) || (u.protocol === 'wss:' ? 443 : 80);
      const path = `${u.pathname}${u.search}`;

      const socket = net.connect(port, host, () => {
        socket.write(
          `GET ${path} HTTP/1.1\r\n` +
            `Host: ${u.host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n\r\n`,
        );
      });

      let headerDone = false;
      let headerBuf = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        if (!headerDone) {
          headerBuf = Buffer.concat([headerBuf, chunk]);
          const end = headerBuf.indexOf('\r\n\r\n');
          if (end < 0) return;
          const header = headerBuf.subarray(0, end).toString('ascii');
          if (!/^HTTP\/1\.1 101/i.test(header)) {
            reject(new Error(`WebSocket upgrade failed: ${header.split('\r\n')[0]}`));
            socket.destroy();
            return;
          }
          headerDone = true;
          this.buffer = headerBuf.subarray(end + 4);
          this.socket = socket;
          resolve();
          this._drain();
          return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this._drain();
      });

      socket.on('error', (err) => {
        if (this.onError) this.onError(err);
        reject(err);
      });
      socket.on('close', () => {
        if (this.onClose) this.onClose();
      });
    });
  }

  _drain() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const hi = this.buffer.readUInt32BE(2);
        const lo = this.buffer.readUInt32BE(6);
        if (hi > 0) return; // frame too large
        len = lo;
        offset = 10;
      }

      let maskKey = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + len) return;

      let payload = this.buffer.subarray(offset, offset + len);
      this.buffer = this.buffer.subarray(offset + len);

      if (masked && maskKey) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
      }

      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        this._sendFrame(0xa, payload, false);
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) {
        if (this.onFrame) this.onFrame(payload);
      }
    }
  }

  /** @param {number} opcode @param {Buffer | string} data @param {boolean} mask */
  _sendFrame(opcode, data, mask = true) {
    if (!this.socket) return;
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = (mask ? 0x80 : 0) | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = (mask ? 0x80 : 0) | 126;
      header.writeUInt16BE(len, 2);
    } else {
      throw new Error('Frame too large');
    }

    const maskKey = mask ? crypto.randomBytes(4) : null;
    let body = payload;
    if (mask && maskKey) {
      body = Buffer.from(payload);
      for (let i = 0; i < body.length; i++) body[i] ^= maskKey[i % 4];
      this.socket.write(Buffer.concat([header, maskKey, body]));
    } else {
      this.socket.write(Buffer.concat([header, body]));
    }
  }

  /** @param {string} text */
  send(text) {
    this._sendFrame(0x1, text, true);
  }

  close() {
    if (this.socket) {
      try {
        this._sendFrame(0x8, Buffer.alloc(0), true);
      } catch {
        /* ignore */
      }
      this.socket.destroy();
      this.socket = null;
    }
  }
}

export class CdpSession {
  /**
   * @param {string} wsUrl
   * @param {{ url?: string, title?: string }} meta
   */
  constructor(wsUrl, meta = {}) {
    this.wsUrl = wsUrl;
    this.meta = meta;
    /** @type {RawWebSocket | null} */
    this.ws = null;
    this.nextId = 1;
    /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void, method?: string }>} */
    this.pending = new Map();
    /** @type {Map<string, ((params: Record<string, unknown>) => void)[]>} */
    this.eventHandlers = new Map();
  }

  async connect() {
    this.ws = new RawWebSocket(this.wsUrl);
    this.ws.onFrame = (buf) => this._onMessage(buf.toString('utf8'));
    this.ws.onError = (err) => {
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
    };
    await this.ws.connect();
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Accessibility.enable').catch(() => {});
  }

  /** @param {string} raw */
  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      const handlers = this.eventHandlers.get(msg.method) ?? [];
      for (const h of handlers) h(msg.params ?? {});
    }
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   */
  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try {
        this.ws?.send(payload);
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  on(event, handler) {
    const list = this.eventHandlers.get(event) ?? [];
    list.push(handler);
    this.eventHandlers.set(event, list);
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  async getUrl() {
    try {
      const tree = await this.send('Page.getFrameTree');
      return tree.frameTree?.frame?.url ?? this.meta.url ?? '';
    } catch {
      return this.meta.url ?? '';
    }
  }

  async getTitle() {
    try {
      return (await this.evaluate('document.title')) ?? this.meta.title ?? '';
    } catch {
      return this.meta.title ?? '';
    }
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitForLoad(30000);
  }

  waitForLoad(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Page load timeout'));
      }, timeoutMs);
      const onLoad = () => {
        cleanup();
        setTimeout(resolve, 800);
      };
      const cleanup = () => {
        clearTimeout(timer);
        const list = this.eventHandlers.get('Page.loadEventFired') ?? [];
        this.eventHandlers.set(
          'Page.loadEventFired',
          list.filter((h) => h !== onLoad),
        );
      };
      this.on('Page.loadEventFired', onLoad);
    });
  }

  async accessibilitySnapshot() {
    try {
      const tree = await this.send('Accessibility.getFullAXTree');
      return tree.nodes?.length ? { role: 'Root', children: tree.nodes.slice(0, 40) } : null;
    } catch {
      return { error: 'Accessibility.getFullAXTree unavailable' };
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * @param {string} cdpBase
 * @param {CdpTarget} [target]
 */
export async function connectToTarget(cdpBase, target) {
  const tab = target ?? pickPortalTab(await listTargets(cdpBase));
  if (!tab?.webSocketDebuggerUrl) {
    throw new Error('No open portal tab found. Open the ACC report page in the debug browser first.');
  }
  const session = new CdpSession(tab.webSocketDebuggerUrl, { url: tab.url, title: tab.title });
  await session.connect();
  return session;
}
