import { Component, type ErrorInfo, type ReactNode } from 'react';
import { downloadText } from '../lib/storage';

export interface ErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  timestamp: string;
  appVersion: string;
}

export function buildErrorReport(error: Error, info?: ErrorInfo): ErrorReport {
  return {
    message: error.message,
    stack: error.stack,
    componentStack: info?.componentStack ?? undefined,
    url: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    timestamp: new Date().toISOString(),
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
  };
}

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    console.error('[ErrorBoundary]', error, info);
  }

  private downloadReport = (): void => {
    const { error, info } = this.state;
    if (!error) return;
    const report = buildErrorReport(error, info);
    const name = `acc-suite-error-${report.timestamp.replace(/[:.]/g, '-')}.json`;
    downloadText(name, JSON.stringify(report, null, 2));
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="h-full flex items-center justify-center p-6"
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >
        <div
          className="max-w-lg w-full rounded-xl border p-6 space-y-4"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-lg font-bold" style={{ color: 'var(--danger-fg)' }}>
            Something went wrong
          </h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            The app hit an unexpected error. Your IndexedDB working copy is usually intact — try reloading.
            Download the error report if you need to share diagnostics with IT.
          </p>
          <pre
            className="text-xs p-3 rounded overflow-auto max-h-32 font-mono"
            style={{ background: 'var(--bg)', color: 'var(--danger-fg)' }}
          >
            {error.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={this.reload}>
              Reload app
            </button>
            <button type="button" className="btn" onClick={this.downloadReport}>
              Download error report
            </button>
          </div>
          {import.meta.env.DEV && (
            <button
              type="button"
              className="btn btn-danger text-xs"
              onClick={() => {
                throw new Error('Dev test error boundary');
              }}
            >
              Throw test error (dev)
            </button>
          )}
        </div>
      </div>
    );
  }
}
