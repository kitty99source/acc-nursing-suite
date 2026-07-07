import { describe, it, expect, beforeEach } from 'vitest';
import { clearLogBuffer, exportDiagnosticsJson, logError, logInfo, readLogEntries } from './logger';

describe('logger', () => {
  beforeEach(() => clearLogBuffer());

  it('buffers entries in order', () => {
    logInfo('app ready', 'init');
    logError('save failed', 'store');
    const entries = readLogEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('app ready');
    expect(entries[1].level).toBe('error');
  });

  it('exports JSON diagnostics', () => {
    logInfo('test');
    const json = exportDiagnosticsJson({ appVersion: '1.0.0' });
    const parsed = JSON.parse(json) as { entries: unknown[]; appVersion: string };
    expect(parsed.appVersion).toBe('1.0.0');
    expect(parsed.entries.length).toBe(1);
  });
});
