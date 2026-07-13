import type { ReactNode } from 'react';
import { IconWarning } from './icons';

/**
 * Shared compact presentation for every assumption/decision banner (rescoping
 * rule #8). Each concrete banner owns its own copy + Settings.*BannerDismissed
 * flag — this only unifies the look so banners stack cleanly.
 */
export function AssumptionBanner({
  title,
  children,
  onDismiss,
}: {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div className="assumption-banner" role="status">
      <span className="assumption-banner-icon" aria-hidden>
        <IconWarning width={15} height={15} />
      </span>
      <p className="assumption-banner-body">
        <strong>{title}</strong> {children}
      </p>
      <button type="button" className="assumption-banner-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
