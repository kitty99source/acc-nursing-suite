/** Local-only ring buffer for diagnostics export (P7-003). No network. */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  message: string;
  context?: string;
}

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];

export function logInfo(message: string, context?: string): void {
  push('info', message, context);
}

export function logWarn(message: string, context?: string): void {
  push('warn', message, context);
}

export function logError(message: string, context?: string): void {
  push('error', message, context);
}

function push(level: LogLevel, message: string, context?: string): void {
  buffer.push({ ts: Date.now(), level, message, context });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

export function readLogEntries(limit = MAX_ENTRIES): LogEntry[] {
  return buffer.slice(-limit);
}

export function exportDiagnosticsJson(extra?: Record<string, unknown>): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      entries: readLogEntries(),
      ...extra,
    },
    null,
    2,
  );
}

export function clearLogBuffer(): void {
  buffer.length = 0;
}
