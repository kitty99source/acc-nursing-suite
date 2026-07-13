import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useConfirm } from '../components/useConfirm';
import { SectionTitle, Card, Field, TextInput, EmptyState, Badge } from '../components/ui';
import { IconPlus, IconTrash, IconSearch, IconMail } from '../components/icons';
import { MailReferenceBanner } from '../components/MailReferenceBanner';
import { uid } from '../lib/format';
import {
  DEFAULT_MAIL_REFERENCE_ENTRIES,
  filterMailReferenceEntries,
  type MailReferenceEntry,
} from '../lib/mailReference';

function emptyEntry(): MailReferenceEntry {
  return {
    id: uid('mailref'),
    formCode: '',
    label: '',
    instructions: '',
    email: '',
    ccEmail: '',
  };
}

/**
 * Editable generic ACC form-routing reference (seeded from Mail Reference Sheet 2024.pdf).
 * No patient data — safe office cheat-sheet.
 */
export function MailReference() {
  const entries = useStore((s) => s.data.settings.mailReferenceEntries);
  const updateSettings = useStore((s) => s.updateSettings);
  const [confirm, confirmDialog] = useConfirm();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(emptyEntry);
  const [addOpen, setAddOpen] = useState(false);

  const list = entries?.length ? entries : DEFAULT_MAIL_REFERENCE_ENTRIES;

  const filtered = useMemo(() => filterMailReferenceEntries(list, search), [list, search]);

  function saveEntries(next: MailReferenceEntry[]) {
    updateSettings({ mailReferenceEntries: next });
  }

  function patchEntry(id: string, patch: Partial<MailReferenceEntry>) {
    saveEntries(list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function removeEntry(id: string) {
    const row = list.find((e) => e.id === id);
    const ok = await confirm({
      title: 'Remove this row?',
      message: `Remove ${row?.formCode || row?.label || 'this entry'} from the Mail Reference Sheet?`,
      destructive: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    saveEntries(list.filter((e) => e.id !== id));
  }

  function addEntry() {
    const formCode = draft.formCode.trim();
    const label = draft.label.trim() || formCode;
    const instructions = draft.instructions.trim();
    if (!formCode || !instructions) return;
    saveEntries([
      ...list,
      {
        ...draft,
        id: uid('mailref'),
        formCode,
        label,
        instructions,
        email: draft.email?.trim() || undefined,
        ccEmail: draft.ccEmail?.trim() || undefined,
      },
    ]);
    setDraft(emptyEntry());
    setAddOpen(false);
  }

  async function resetDefaults() {
    const ok = await confirm({
      title: 'Reset to 2024 defaults?',
      message: 'This replaces your edited list with the seeded Mail Reference Sheet 2024 rows.',
      destructive: true,
      confirmLabel: 'Reset',
    });
    if (!ok) return;
    saveEntries(DEFAULT_MAIL_REFERENCE_ENTRIES.map((e) => ({ ...e })));
  }

  return (
    <div>
      <MailReferenceBanner />
      <SectionTitle
        title="Mail Reference Sheet"
        subtitle="Where each ACC form / mail type goes — seeded from the 2024 Team Processes sheet. Edit freely."
        actions={
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={() => void resetDefaults()}>
              Reset to 2024 defaults
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen((v) => !v)}>
              <IconPlus width={14} height={14} /> {addOpen ? 'Cancel' : 'Add row'}
            </button>
          </div>
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }}>
            <IconSearch width={14} height={14} />
          </span>
          <TextInput
            className="pl-7"
            placeholder="Search form code, destination, instructions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search mail reference"
          />
        </div>
        <Badge tone="neutral">{filtered.length} row(s)</Badge>
      </div>

      {addOpen && (
        <Card className="mb-3">
          <h3 className="text-sm font-semibold mb-2">New row</h3>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <Field label="Form code" required>
              <TextInput
                value={draft.formCode}
                onChange={(e) => setDraft((d) => ({ ...d, formCode: e.target.value }))}
                placeholder="e.g. ACC45"
              />
            </Field>
            <Field label="Label">
              <TextInput
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Optional longer name"
              />
            </Field>
            <Field label="Email">
              <TextInput
                value={draft.email ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                placeholder="optional@"
              />
            </Field>
            <Field label="CC">
              <TextInput
                value={draft.ccEmail ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, ccEmail: e.target.value }))}
                placeholder="optional@"
              />
            </Field>
            <div className="col-span-full">
              <Field label="Instructions" required>
                <TextInput
                  value={draft.instructions}
                  onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
                  placeholder="What to do with this form"
                />
              </Field>
            </div>
          </div>
          <div className="mt-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!draft.formCode.trim() || !draft.instructions.trim()}
              onClick={addEntry}
            >
              Save row
            </button>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<IconMail />}
          title="No matching rows"
          message="Try a different search, or add a new row."
        />
      ) : (
        <div className="grid gap-2">
          {filtered.map((entry) => (
            <Card key={entry.id}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge tone="accent">{entry.formCode || '—'}</Badge>
                  <span className="text-sm font-semibold truncate">{entry.label || entry.formCode}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-icon btn-icon-danger shrink-0"
                  title="Remove row"
                  aria-label={`Remove ${entry.formCode}`}
                  onClick={() => void removeEntry(entry.id)}
                >
                  <IconTrash width={14} height={14} />
                </button>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                <Field label="Form code">
                  <TextInput
                    value={entry.formCode}
                    onChange={(e) => patchEntry(entry.id, { formCode: e.target.value })}
                  />
                </Field>
                <Field label="Label">
                  <TextInput
                    value={entry.label}
                    onChange={(e) => patchEntry(entry.id, { label: e.target.value })}
                  />
                </Field>
                <Field label="Email">
                  <TextInput
                    value={entry.email ?? ''}
                    onChange={(e) => patchEntry(entry.id, { email: e.target.value || undefined })}
                  />
                </Field>
                <Field label="CC">
                  <TextInput
                    value={entry.ccEmail ?? ''}
                    onChange={(e) => patchEntry(entry.id, { ccEmail: e.target.value || undefined })}
                  />
                </Field>
                <div className="col-span-full">
                  <Field label="Instructions">
                    <TextInput
                      value={entry.instructions}
                      onChange={(e) => patchEntry(entry.id, { instructions: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
