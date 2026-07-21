import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose in a ref so the focus-trap effect can call it
  // without re-running (and stealing focus) on every parent re-render.
  // Bug: previously the effect had `onClose` in its dep list, so every parent
  // keystroke recreated the inline `onClose` callback, re-ran the effect, and
  // pulled focus back to the header Close button after each character typed.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Initial focus: run ONLY when `open` flips true. Prefer inputs over the
  // header Close button so typing into a text field never triggers the
  // "focus jumps to Close" regression.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const preferred = root.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, textarea',
      );
      if (preferred) {
        preferred.focus();
        return;
      }
      const anyButton = root.querySelector<HTMLElement>(
        'button:not([data-modal-chrome])',
      );
      anyButton?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [open]);

  // Keyboard: Escape closes, Tab wraps focus. Depends only on `open`; uses
  // the ref to always see the latest `onClose` without re-binding listeners.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`card w-full ${widths[size]} max-h-[calc(100dvh-2rem)] flex flex-col shadow-xl max-sm:max-w-none`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-base font-bold">{title}</h2>
          <button
            className="btn btn-icon"
            onClick={onClose}
            aria-label="Close"
            data-modal-chrome="close"
          >
            <IconClose />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && (
          <div
            className="flex items-center justify-end gap-2 px-5 py-3 border-t flex-wrap shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} size="sm" footer={
      <>
        <button className="btn" onClick={onCancel}>{cancelLabel}</button>
        <button className={destructive ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </>
    }>
      <div className="text-sm" style={{ color: 'var(--text)' }}>{message}</div>
    </Modal>
  );
}
