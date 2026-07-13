import { describe, expect, it } from 'vitest';
import {
  BRIDGE_POLL_HEALTHY_MS,
  BRIDGE_POLL_RECONNECT_MS,
  bridgeBannerPhase,
  bridgeConnectingBannerCopy,
  bridgeEmptyQueueMessage,
  bridgeIDriveWriteFailedMessage,
  bridgeMissingFileMessage,
  bridgeStatusBannerCopy,
  bridgeUnavailableBannerCopy,
  nextBridgePollIntervalMs,
} from './bridgeReconnect';

describe('nextBridgePollIntervalMs', () => {
  it('polls faster while unavailable or still connecting', () => {
    expect(nextBridgePollIntervalMs('unavailable')).toBe(BRIDGE_POLL_RECONNECT_MS);
    expect(nextBridgePollIntervalMs(null)).toBe(BRIDGE_POLL_RECONNECT_MS);
    expect(nextBridgePollIntervalMs('ok')).toBe(BRIDGE_POLL_HEALTHY_MS);
    expect(nextBridgePollIntervalMs('empty')).toBe(BRIDGE_POLL_HEALTHY_MS);
  });
});

describe('bridgeBannerPhase / bridgeStatusBannerCopy', () => {
  it('shows connecting while status is unknown, reconnecting when down, nothing when up', () => {
    expect(bridgeBannerPhase(null)).toBe('connecting');
    expect(bridgeBannerPhase('unavailable')).toBe('reconnecting');
    expect(bridgeBannerPhase('ok')).toBeNull();
    expect(bridgeBannerPhase('empty')).toBeNull();

    expect(bridgeStatusBannerCopy({ status: 'ok', isDev: false })).toBeNull();
    expect(bridgeStatusBannerCopy({ status: null, isDev: false })?.title).toMatch(/Connecting/i);
    expect(bridgeStatusBannerCopy({ status: 'unavailable', isDev: false })?.title).toMatch(/Reconnecting/i);
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

describe('bridgeConnectingBannerCopy', () => {
  it('is immediate coworker-safe connecting copy', () => {
    const c = bridgeConnectingBannerCopy({ isDev: false, ingressNoun: 'letters' });
    expect(c.title).toMatch(/Connecting/i);
    expect(c.body).toMatch(/letters/);
    expect(c.body).not.toMatch(/Start WFH/i);
  });
});

describe('empty / missing-file copy', () => {
  it('avoids manual WFH instructions for coworkers', () => {
    const empty = bridgeEmptyQueueMessage({ isDev: false, inboxFolderHint: 'ACC-Inbox' });
    expect(empty).toMatch(/ACC-Inbox/);
    expect(empty).not.toMatch(/Start WFH/i);
    expect(bridgeMissingFileMessage({ isDev: false })).not.toMatch(/Start WFH/i);
  });
});

describe('bridgeIDriveWriteFailedMessage', () => {
  it('suggests soft reconnect / retry in production', () => {
    const msg = bridgeIDriveWriteFailedMessage({ isDev: false, error: 'Failed to fetch' });
    expect(msg).toMatch(/Failed to fetch/);
    expect(msg).toMatch(/reconnect/i);
    expect(msg).toMatch(/retry Stage to I-drive/i);
    expect(msg).not.toMatch(/Start WFH/i);
  });

  it('mentions quiet launcher in dev', () => {
    expect(bridgeIDriveWriteFailedMessage({ isDev: true })).toMatch(/quiet \.vbs/i);
  });
});
