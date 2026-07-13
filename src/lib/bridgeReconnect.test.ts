import { describe, expect, it } from 'vitest';
import {
  BRIDGE_POLL_HEALTHY_MS,
  BRIDGE_POLL_RECONNECT_MS,
  bridgeEmptyQueueMessage,
  bridgeIDriveWriteFailedMessage,
  bridgeMissingFileMessage,
  bridgeUnavailableBannerCopy,
  nextBridgePollIntervalMs,
} from './bridgeReconnect';

describe('nextBridgePollIntervalMs', () => {
  it('polls faster while unavailable', () => {
    expect(nextBridgePollIntervalMs('unavailable')).toBe(BRIDGE_POLL_RECONNECT_MS);
    expect(nextBridgePollIntervalMs('ok')).toBe(BRIDGE_POLL_HEALTHY_MS);
    expect(nextBridgePollIntervalMs('empty')).toBe(BRIDGE_POLL_HEALTHY_MS);
    expect(nextBridgePollIntervalMs(null)).toBe(BRIDGE_POLL_HEALTHY_MS);
  });
});

describe('bridgeUnavailableBannerCopy', () => {
  it('uses reconnect copy in production', () => {
    const c = bridgeUnavailableBannerCopy({ isDev: false, ingressNoun: 'loan emails' });
    expect(c.title).toMatch(/Reconnecting/i);
    expect(c.body).not.toMatch(/WFH Mode\.cmd/i);
    expect(c.body).not.toMatch(/Folder Watch\.cmd/i);
    expect(c.body).toMatch(/loan emails/);
  });

  it('uses a short dev tip in npm run dev', () => {
    const c = bridgeUnavailableBannerCopy({ isDev: true });
    expect(c.title).toMatch(/not detected/i);
    expect(c.body).toMatch(/npm run dev/i);
    expect(c.body).toMatch(/quiet \.vbs/i);
  });
});

describe('empty / missing-file copy', () => {
  it('avoids manual WFH instructions for coworkers', () => {
    const empty = bridgeEmptyQueueMessage({ isDev: false, inboxFolderHint: 'ACC-LoanEq-Inbox' });
    expect(empty).toMatch(/ACC-LoanEq-Inbox/);
    expect(empty).not.toMatch(/Start WFH/i);
    expect(bridgeMissingFileMessage({ isDev: false })).not.toMatch(/Start WFH/i);
  });
});

describe('bridgeIDriveWriteFailedMessage', () => {
  it('suggests soft reconnect / retry in production', () => {
    const msg = bridgeIDriveWriteFailedMessage({ isDev: false, error: 'Failed to fetch' });
    expect(msg).toMatch(/Failed to fetch/);
    expect(msg).toMatch(/reconnect/i);
    expect(msg).not.toMatch(/Start WFH/i);
  });
});
