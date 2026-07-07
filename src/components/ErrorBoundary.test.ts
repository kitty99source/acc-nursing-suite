import { describe, it, expect } from 'vitest';
import { buildErrorReport } from './ErrorBoundary';

describe('ErrorBoundary', () => {
  it('builds diagnosable error report JSON', () => {
    const err = new Error('Test render failure');
    err.stack = 'Error: Test render failure\n    at App';
    const report = buildErrorReport(err, { componentStack: '\n    in App' });
    expect(report.message).toBe('Test render failure');
    expect(report.stack).toContain('Test render failure');
    expect(report.componentStack).toContain('App');
    expect(report.timestamp).toBeTruthy();
  });
});
