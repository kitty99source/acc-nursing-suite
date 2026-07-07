import { useRef, type ReactNode } from 'react';
import { useStore } from '../state/store';
import type { prefillFromParsed } from '../lib/letterImport';
import type { LetterImportContext } from '../lib/letterImport';

export const LETTER_IMPORT_LABEL = 'Import ACC letter (PDF)';
export const PREFILL_FROM_LETTER_LABEL = 'Prefill from letter';
/** Bordered accent style — use for every ACC letter import entry point. */
export const LETTER_IMPORT_BTN_CLASS = 'btn btn-outline btn-sm';

export type LetterImportEntryPoint =
  | 'approvals'
  | 'declines'
  | 'patients'
  | 'claim-documents'
  | 'prefill'
  | 'global'
  | 'review-queue';

/** Tooltip for full-save entry points (Patients list, Approvals, Declines). */
export const LETTER_IMPORT_FULL_TOOLTIP =
  'Import an ACC approval or decline letter — creates or updates the full patient record, claim, and related data.';

type OpenLetterImportOpts = {
  context?: LetterImportContext;
  prefillOnly?: boolean;
  onPrefill?: (patches: ReturnType<typeof prefillFromParsed>) => void;
  /** Where the user opened import — drives confirm-modal guidance. */
  entryPoint?: LetterImportEntryPoint;
};

export function LetterImportButton({
  opts,
  label = LETTER_IMPORT_LABEL,
  className = LETTER_IMPORT_BTN_CLASS,
  disabled,
  title,
  children,
}: {
  opts?: OpenLetterImportOpts;
  label?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  children?: ReactNode;
}) {
  const openLetterImport = useStore((s) => s.openLetterImport);
  const inputRef = useRef<HTMLInputElement>(null);
  const optsRef = useRef<OpenLetterImportOpts | undefined>(opts);

  function pick() {
    optsRef.current = opts;
    inputRef.current?.click();
  }

  return (
    <>
      <button type="button" className={className} disabled={disabled} title={title} onClick={pick}>
        {children ?? label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) openLetterImport(file, optsRef.current);
          e.target.value = '';
        }}
      />
    </>
  );
}
