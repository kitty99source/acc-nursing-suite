// ============================================================================
// Coworker-safe copy + poll timing when the local /_acc bridge is down.
// Quiet/recommended sessions run supervisor.ps1, which restarts launch +
// folder-watch silently — the SPA should reconnect, not tell people to open
// a .cmd. Manual tips are for npm run dev / missing supervisor only.
// ============================================================================

import type { StagingBridgeStatus } from './localAccBridge';

/** Normal Review Queue / background poll when the bridge is healthy. */
export const BRIDGE_POLL_HEALTHY_MS = 30_000;

/** Faster probe while reconnecting after a mid-session helper restart. */
export const BRIDGE_POLL_RECONNECT_MS = 3_000;

export function nextBridgePollIntervalMs(status: StagingBridgeStatus | null | undefined): number {
  // null = first probe still in flight — poll fast once it settles to unavailable.
  return status === 'unavailable' || status == null ? BRIDGE_POLL_RECONNECT_MS : BRIDGE_POLL_HEALTHY_MS;
}

export type BridgeBannerPhase = 'connecting' | 'reconnecting';

/** Live banner while status is unknown (null) or known-down. Hide when ok/empty. */
export function bridgeBannerPhase(
  status: StagingBridgeStatus | null | undefined,
): BridgeBannerPhase | null {
  if (status == null) return 'connecting';
  if (status === 'unavailable') return 'reconnecting';
  return null;
}

export interface BridgeUnavailableCopy {
  title: string;
  body: string;
}

/** Immediate feedback while the first `/_acc` probe is in flight. */
export function bridgeConnectingBannerCopy(opts: {
  isDev: boolean;
  ingressNoun?: string;
}): BridgeUnavailableCopy {
  const noun = (opts.ingressNoun ?? 'emails').trim() || 'emails';
  if (opts.isDev) {
    return {
      title: 'Connecting to local helper…',
      body:
        `Checking for the /_acc bridge (expected missing under \`npm run dev\`). ` +
        `New ${noun} import automatically when the supervised launcher is running.`,
    };
  }
  return {
    title: 'Connecting to local helper…',
    body: `Checking whether new ${noun} can import automatically…`,
  };
}

/**
 * Banner when `/_acc/staging` cannot be reached.
 * Production (quiet/recommended): soft reconnect copy, no terminal instructions.
 * Dev (`import.meta.env.DEV`): brief tip to start the supervised launcher.
 */
export function bridgeUnavailableBannerCopy(opts: {
  isDev: boolean;
  /** e.g. "loan emails" / "letters" */
  ingressNoun?: string;
}): BridgeUnavailableCopy {
  const noun = (opts.ingressNoun ?? 'emails').trim() || 'emails';
  if (opts.isDev) {
    return {
      title: 'Local helper not detected',
      body:
        `New ${noun} will not import automatically. ` +
        'In production, start via the quiet .vbs (or recommended .cmd) so the supervisor keeps the /_acc bridge alive. ' +
        '`npm run dev` has no bridge — that is expected here.',
    };
  }
  return {
    title: 'Reconnecting to local helper…',
    body:
      `New ${noun} will import again automatically once the helper is back. ` +
      'You do not need to open a terminal or run a .cmd — just keep this tab open.',
  };
}

/** Resolve Connecting vs Reconnecting copy from current probe status. */
export function bridgeStatusBannerCopy(opts: {
  status: StagingBridgeStatus | null | undefined;
  isDev: boolean;
  ingressNoun?: string;
}): BridgeUnavailableCopy | null {
  const phase = bridgeBannerPhase(opts.status);
  if (phase === 'connecting') return bridgeConnectingBannerCopy(opts);
  if (phase === 'reconnecting') return bridgeUnavailableBannerCopy(opts);
  return null;
}

/** Empty Review Queue guidance — no "run Start WFH Mode.cmd" for coworkers. */
export function bridgeEmptyQueueMessage(opts: { isDev: boolean; inboxFolderHint: string }): string {
  const hint = opts.inboxFolderHint.trim() || 'the inbox drop folder';
  if (opts.isDev) {
    return (
      `Synced attachments and files dropped in ${hint} appear here when the supervised launcher is running. ` +
      '`npm run dev` has no /_acc bridge — use the quiet .vbs for a real session.'
    );
  }
  return (
    `Synced attachments and files dropped in ${hint} appear here automatically. ` +
    'If nothing shows up yet, wait a moment — the local helper reconnects on its own.'
  );
}

/** Attachment resolve failure while the bridge may be restarting. */
export function bridgeMissingFileMessage(opts: { isDev: boolean }): string {
  if (opts.isDev) {
    return (
      "Couldn't find the letter file. Start the quiet .vbs / recommended launcher, or pick the file below to continue."
    );
  }
  return (
    "Couldn't find the letter file right now (the local helper may be reconnecting). " +
    'Wait a moment, or pick the file below to continue.'
  );
}

/** I-drive POST failed — soft reconnect / retry, not "start WFH Mode.cmd". */
export function bridgeIDriveWriteFailedMessage(opts: { isDev: boolean; error?: string }): string {
  const detail = (opts.error ?? '').trim();
  const prefix = detail ? `I-drive staging failed: ${detail}. ` : 'I-drive staging failed. ';
  if (opts.isDev) {
    return (
      prefix +
      'Start the quiet .vbs / recommended launcher so the /_acc bridge can write, then retry Stage to I-drive.'
    );
  }
  return (
    prefix +
    'The local helper may be reconnecting — wait a moment and retry Stage to I-drive. You do not need to open a .cmd.'
  );
}
