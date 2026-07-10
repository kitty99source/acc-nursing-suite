import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-card"
      style={{ color: 'var(--muted)', border: '1px dashed var(--border)' }}
    >
      {icon && <div className="mb-3 opacity-70">{icon}</div>}
      <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
        {title}
      </h3>
      <p className="text-sm mt-1 max-w-md">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
  required,
  labelAction,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Compact control shown at the right of the label row (e.g. a re-parse icon). */
  labelAction?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label flex items-center justify-between gap-1">
        <span>
          {label}
          {required && <span style={{ color: 'var(--danger-fg)' }}> *</span>}
        </span>
        {labelAction}
      </span>
      {children}
      {hint && !error && (
        <span className="block text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {hint}
        </span>
      )}
      {error && (
        <span className="block text-xs mt-1 font-medium" style={{ color: 'var(--danger-fg)' }}>
          {error}
        </span>
      )}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={`input ${props.className ?? ''}`} />;
}

export function DateInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" {...props} className={`input ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ''}`} />;
}

type BadgeTone = 'neutral' | 'good' | 'warn' | 'danger' | 'salmon' | 'accent';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  const styles: Record<BadgeTone, { background: string; color: string }> = {
    neutral: { background: 'var(--surface-2)', color: 'var(--muted)' },
    good: { background: 'var(--good)', color: 'var(--good-fg)' },
    warn: { background: 'var(--warn)', color: 'var(--warn-fg)' },
    danger: { background: 'var(--danger)', color: 'var(--danger-fg)' },
    salmon: { background: 'var(--salmon)', color: 'var(--salmon-fg)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent)' },
  };
  return (
    <span className="badge" style={styles[tone]}>
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: BadgeTone;
  hint?: string;
}) {
  const accentColor: Record<BadgeTone, string> = {
    neutral: 'var(--text)',
    good: 'var(--good-fg)',
    warn: 'var(--warn-fg)',
    danger: 'var(--danger-fg)',
    salmon: 'var(--salmon-fg)',
    accent: 'var(--accent)',
  };
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="text-2xl font-bold mt-1" style={{ color: accentColor[tone] }}>
        {value}
      </div>
      {hint && (
        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}
