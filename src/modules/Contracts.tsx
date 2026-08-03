import { useState } from 'react';
import { useStore } from '../state/store';
import { useAiChatStore } from '../state/aiChatStore';
import { makeContractChip } from '../lib/aiChatContext';
import { DataTable, customColumns, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
import { SectionTitle, Field, DateInput, TextInput, NumberInput, TextArea, EmptyState, Badge } from '../components/ui';
import { IconPlus, IconEdit, IconTrash, IconContract, IconChat, IconClose } from '../components/icons';
import { formatDate, todayISO } from '../lib/format';
import type { Contract, ContractRateEntry } from '../types';

// ============================================================================
// Contract CRUD — a real, first-class record type (2026-08-04 owner ask:
// "know about ACC contracts... anything else it'd need to know or be able to
// search up"). AdminSuite had NO Contract data model at all before this;
// per the earlier feature-parity audit this confirmed to still be true.
// Modeled after the sibling ACC-RemittanceTracker suite's
// `AccreditedEmployer` (name + customer number) plus the fields this app's
// own domain needs (effective dates, service codes covered, a rate table) —
// see docs/research/ai-chat-assistant-2026-08.md for the full writeup on why
// this is a structured-data-first step rather than a full contract-PDF-text
// RAG pipeline (no real contract document corpus exists yet to search).
//
// Deliberately NOT seeded with any data mirrored from RemittanceTracker's
// `employerCatalog.ts` — that file's real AR customer numbers were flagged
// in this team's own backlog notes as an open "does this need scrubbing"
// question that was never resolved, so nothing from it is duplicated here
// without the owner's explicit sign-off. Contracts starts empty; the owner
// adds real ones through this CRUD UI.
// ============================================================================

function emptyContract(): Omit<Contract, 'id'> {
  return {
    providerName: '',
    customerNumber: '',
    claimsEmail: '',
    effectiveFrom: todayISO(),
    effectiveTo: '',
    serviceCodesCovered: [],
    rateTable: [],
    notes: '',
  };
}

function parseCodes(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function Contracts() {
  const data = useStore((s) => s.data);
  const addContract = useStore((s) => s.addContract);
  const updateContract = useStore((s) => s.updateContract);
  const removeContract = useStore((s) => s.removeContract);
  const addAiChip = useAiChatStore((s) => s.addChip);
  const openAiChat = useAiChatStore((s) => s.setOpen);
  const [confirm, confirmDialog] = useConfirm();

  const contracts = data.contracts ?? [];

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<Omit<Contract, 'id'>>(emptyContract());
  const [codesText, setCodesText] = useState('');
  const [rateDraft, setRateDraft] = useState<ContractRateEntry>({ serviceCode: '', description: '', rate: 0 });

  function openCreate() {
    setForm(emptyContract());
    setCodesText('');
    setRateDraft({ serviceCode: '', description: '', rate: 0 });
    setCreating(true);
  }
  function openEdit(c: Contract) {
    setForm({ ...c });
    setCodesText(c.serviceCodesCovered.join(', '));
    setRateDraft({ serviceCode: '', description: '', rate: 0 });
    setEditing(c);
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }
  function save() {
    const payload = { ...form, serviceCodesCovered: parseCodes(codesText) };
    if (creating) addContract(payload);
    else if (editing) updateContract(editing.id, payload);
    close();
  }
  async function del(c: Contract) {
    const ok = await confirm({
      title: 'Delete contract?',
      message: `Delete the contract with ${c.providerName || 'this provider'}?`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) removeContract(c.id);
  }
  function addRateRow() {
    if (!rateDraft.serviceCode.trim()) return;
    setForm({ ...form, rateTable: [...form.rateTable, { ...rateDraft }] });
    setRateDraft({ serviceCode: '', description: '', rate: 0 });
  }
  function removeRateRow(idx: number) {
    setForm({ ...form, rateTable: form.rateTable.filter((_, i) => i !== idx) });
  }

  const columns: Column<Contract>[] = [
    {
      key: 'provider',
      header: 'Provider / employer',
      sortable: true,
      sortValue: (r) => r.providerName,
      render: (r) => <span className="font-medium">{r.providerName || '—'}</span>,
    },
    { key: 'customer', header: 'Customer #', render: (r) => r.customerNumber || '—' },
    {
      key: 'codes',
      header: 'Service codes',
      render: (r) =>
        r.serviceCodesCovered.length ? (
          <div className="flex flex-wrap gap-1">
            {r.serviceCodesCovered.map((code) => (
              <Badge key={code} tone="neutral">
                {code}
              </Badge>
            ))}
          </div>
        ) : (
          '—'
        ),
    },
    { key: 'rates', header: 'Rate lines', render: (r) => r.rateTable.length || '—' },
    {
      key: 'effective',
      header: 'Effective',
      sortable: true,
      sortValue: (r) => r.effectiveFrom,
      render: (r) => (
        <span>
          {formatDate(r.effectiveFrom)} – {r.effectiveTo ? formatDate(r.effectiveTo) : 'ongoing'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1 justify-end">
          {data.settings.aiFeaturesEnabled && (
            <button
              className="btn btn-icon btn-ghost"
              title="Add to AI chat context"
              aria-label={`Add ${r.providerName} to AI chat context`}
              onClick={() => {
                addAiChip(makeContractChip(r));
                openAiChat(true);
              }}
            >
              <IconChat width={14} height={14} />
            </button>
          )}
          <button className="btn btn-icon" onClick={() => openEdit(r)} aria-label="Edit">
            <IconEdit width={15} height={15} />
          </button>
          <button className="btn btn-icon btn-icon-danger" onClick={() => void del(r)} aria-label="Delete">
            <IconTrash width={15} height={15} />
          </button>
        </div>
      ),
    },
  ];

  const extraColumns = customColumns(contracts, (r) => r.customFields);
  if (extraColumns.length) columns.splice(columns.length - 1, 0, ...extraColumns);

  return (
    <div>
      <SectionTitle
        title="Contracts"
        subtitle="Provider/employer contracts and price agreements — rate tables, effective dates, service codes covered."
        actions={
          <button className="btn btn-primary" onClick={openCreate}>
            <IconPlus /> New contract
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={contracts}
        rowKey={(r) => r.id}
        initialSort={{ key: 'provider', dir: 'asc' }}
        emptyState={
          <EmptyState
            icon={<IconContract width={32} height={32} />}
            title="No contracts on file"
            message="Add a provider/employer contract: rate table, effective dates, and service codes covered."
            action={
              <button className="btn btn-primary" onClick={openCreate}>
                <IconPlus /> New contract
              </button>
            }
          />
        }
      />

      <Modal
        open={creating || !!editing}
        title={creating ? 'New contract' : 'Edit contract'}
        onClose={close}
        size="lg"
        footer={
          <>
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!form.providerName}>
              Save
            </button>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Provider / employer name" required>
            <TextInput value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} />
          </Field>
          <Field label="Customer number">
            <TextInput value={form.customerNumber ?? ''} onChange={(e) => setForm({ ...form, customerNumber: e.target.value })} />
          </Field>
          <Field label="Claims email">
            <TextInput value={form.claimsEmail ?? ''} onChange={(e) => setForm({ ...form, claimsEmail: e.target.value })} />
          </Field>
          <Field label="Service codes covered (comma-separated)">
            <TextInput value={codesText} onChange={(e) => setCodesText(e.target.value)} placeholder="NS04, NS05" />
          </Field>
          <Field label="Effective from">
            <DateInput value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          </Field>
          <Field label="Effective to (blank = ongoing)">
            <DateInput value={form.effectiveTo ?? ''} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Rate table">
              <div className="space-y-1 mb-2">
                {form.rateTable.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{r.serviceCode}</span>
                    {r.description && <span style={{ color: 'var(--muted)' }}>{r.description}</span>}
                    <span className="ml-auto">${r.rate.toFixed(2)}</span>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost"
                      onClick={() => removeRateRow(idx)}
                      aria-label={`Remove rate line ${r.serviceCode}`}
                    >
                      <IconClose width={12} height={12} />
                    </button>
                  </div>
                ))}
                {form.rateTable.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    No rate lines yet.
                  </p>
                )}
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <TextInput
                    placeholder="Service code"
                    value={rateDraft.serviceCode}
                    onChange={(e) => setRateDraft({ ...rateDraft, serviceCode: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <TextInput
                    placeholder="Description (optional)"
                    value={rateDraft.description ?? ''}
                    onChange={(e) => setRateDraft({ ...rateDraft, description: e.target.value })}
                  />
                </div>
                <div style={{ width: 100 }}>
                  <NumberInput
                    placeholder="Rate"
                    value={rateDraft.rate || ''}
                    onChange={(e) => setRateDraft({ ...rateDraft, rate: Number(e.target.value) || 0 })}
                  />
                </div>
                <button type="button" className="btn" onClick={addRateRow} disabled={!rateDraft.serviceCode.trim()}>
                  <IconPlus width={14} height={14} /> Add
                </button>
              </div>
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Notes">
              <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
