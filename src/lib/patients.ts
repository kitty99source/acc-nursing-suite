import type { AppData, Patient } from '../types';
import { normalizeNhi } from './validation';

// ============================================================================
// Patient duplicate detection + merge.
//
// Matching order (same spirit as letterImport's NHI lookup and Excel's
// EntityReconciler): NHI is the hard primary key; name+DOB is a soft
// secondary when NHI is blank on one or both sides. Name alone is never
// enough — too many collisions. Pure helpers; callers surface results for
// review and only merge/delete after explicit confirmation (Approvals'
// findDuplicateApprovalsByPO pattern).
// ============================================================================

export type PatientMatchKind = 'nhi' | 'name-dob';

export interface PatientMatch {
  patient: Patient;
  kind: PatientMatchKind;
}

export interface DuplicatePatientGroup {
  /** Grouping key: `nhi:…` or `name-dob:…`. */
  key: string;
  kind: PatientMatchKind;
  /** All patients in the group, suggested survivor first. */
  patients: Patient[];
  /** Suggested survivor (richest linked data / most complete fields). */
  keep: Patient;
  /** Everyone else — merge into keep, then remove. */
  redundant: Patient[];
}

export interface PatientCandidate {
  name?: string;
  nhi?: string;
  dob?: string;
}

export function normalizePatientName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDob(dob: string): string {
  return dob.trim();
}

/** How "complete" a patient row looks — used only to suggest a survivor. */
function completenessScore(p: Patient): number {
  let score = 0;
  if (normalizeNhi(p.nhi)) score += 4;
  if (normalizePatientName(p.name)) score += 2;
  if (normalizeDob(p.dob)) score += 2;
  if (p.notes?.trim()) score += 1;
  return score;
}

/** Count of records that would move with this patient on a merge. */
export function patientLinkedWeight(data: AppData, patientId: string): number {
  const claims = data.claims.filter((c) => c.patientId === patientId);
  const claimIds = new Set(claims.map((c) => c.id));
  const approvals = data.approvals.filter((a) => a.patientId === patientId).length;
  const docs = data.documents.filter((d) => claimIds.has(d.claimId)).length;
  const memos = (data.memos ?? []).filter((m) => m.patientId === patientId).length;
  const declines = data.declines.filter((d) => d.patientId === patientId).length;
  return claims.length * 10 + approvals * 3 + docs * 2 + memos + declines;
}

export function suggestKeepPatient(data: AppData, patients: Patient[]): Patient {
  return [...patients].sort((a, b) => {
    const w = patientLinkedWeight(data, b.id) - patientLinkedWeight(data, a.id);
    if (w !== 0) return w;
    const c = completenessScore(b) - completenessScore(a);
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Find an existing patient that matches the candidate.
 * Prefer NHI (any existing patient with the same normalized NHI). Fall back to
 * exact normalized name + DOB only when both sides have a DOB.
 */
export function findMatchingPatient(
  patients: Patient[],
  candidate: PatientCandidate,
  opts?: { excludeId?: string },
): PatientMatch | undefined {
  const nhi = normalizeNhi(candidate.nhi);
  const name = normalizePatientName(candidate.name ?? '');
  const dob = normalizeDob(candidate.dob ?? '');
  const pool = opts?.excludeId
    ? patients.filter((p) => p.id !== opts.excludeId)
    : patients;

  if (nhi) {
    const hit = pool.find((p) => normalizeNhi(p.nhi) === nhi);
    if (hit) return { patient: hit, kind: 'nhi' };
  }

  if (name && dob) {
    const hit = pool.find(
      (p) => normalizePatientName(p.name) === name && normalizeDob(p.dob) === dob,
    );
    if (hit) return { patient: hit, kind: 'name-dob' };
  }

  return undefined;
}

/**
 * Scan the patient list for duplicate groups. Patients can appear in at most
 * one group (NHI groups take precedence over name+DOB when both apply).
 */
export function findDuplicatePatientGroups(
  patients: Patient[],
  data?: AppData,
): DuplicatePatientGroup[] {
  const claimed = new Set<string>();
  const groups: DuplicatePatientGroup[] = [];
  const empty: AppData = data ?? {
    schemaVersion: 0,
    patients,
    claims: [],
    serviceLines: [],
    approvals: [],
    invoiceLines: [],
    complexCases: [],
    declines: [],
    settings: {} as AppData['settings'],
    documents: [],
    memos: [],
  };

  const byNhi = new Map<string, Patient[]>();
  for (const p of patients) {
    const nhi = normalizeNhi(p.nhi);
    if (!nhi) continue;
    const list = byNhi.get(nhi);
    if (list) list.push(p);
    else byNhi.set(nhi, [p]);
  }
  for (const [nhi, list] of byNhi) {
    if (list.length < 2) continue;
    for (const p of list) claimed.add(p.id);
    const keep = suggestKeepPatient(empty, list);
    const redundant = list.filter((p) => p.id !== keep.id);
    groups.push({
      key: `nhi:${nhi}`,
      kind: 'nhi',
      patients: [keep, ...redundant],
      keep,
      redundant,
    });
  }

  const byNameDob = new Map<string, Patient[]>();
  for (const p of patients) {
    if (claimed.has(p.id)) continue;
    const name = normalizePatientName(p.name);
    const dob = normalizeDob(p.dob);
    if (!name || !dob) continue;
    const key = `${name}|${dob}`;
    const list = byNameDob.get(key);
    if (list) list.push(p);
    else byNameDob.set(key, [p]);
  }
  for (const [key, list] of byNameDob) {
    if (list.length < 2) continue;
    // Distinct non-blank NHIs mean distinct people — never merge those.
    const distinctNhis = new Set(
      list.map((p) => normalizeNhi(p.nhi)).filter(Boolean),
    );
    if (distinctNhis.size > 1) continue;
    const keep = suggestKeepPatient(empty, list);
    const redundant = list.filter((p) => p.id !== keep.id);
    groups.push({
      key: `name-dob:${key}`,
      kind: 'name-dob',
      patients: [keep, ...redundant],
      keep,
      redundant,
    });
  }

  return groups;
}

function fillEmptyFields(keep: Patient, from: Patient): Patient {
  const notesParts = [keep.notes?.trim(), from.notes?.trim()].filter(Boolean);
  return {
    ...keep,
    nhi: normalizeNhi(keep.nhi) || from.nhi,
    dob: normalizeDob(keep.dob) || from.dob,
    name: keep.name.trim() || from.name,
    notes: notesParts.length ? [...new Set(notesParts)].join('\n\n') : keep.notes,
  };
}

/**
 * Pure merge: remaps claims / approvals / declines / memos / importHistory
 * from each drop id onto keepId, folds empty demographic fields, then removes
 * the duplicate patient rows. Does not delete claim documents (they stay on
 * remapped claims). Callers must confirm before applying.
 */
export function mergePatientsIntoData(
  data: AppData,
  keepId: string,
  dropIds: string[],
): AppData {
  const drops = new Set(dropIds.filter((id) => id !== keepId));
  if (drops.size === 0) return data;

  const keep = data.patients.find((p) => p.id === keepId);
  if (!keep) return data;

  let mergedKeep = keep;
  for (const id of drops) {
    const dup = data.patients.find((p) => p.id === id);
    if (dup) mergedKeep = fillEmptyFields(mergedKeep, dup);
  }

  return {
    ...data,
    patients: data.patients
      .filter((p) => !drops.has(p.id))
      .map((p) => (p.id === keepId ? mergedKeep : p)),
    claims: data.claims.map((c) =>
      drops.has(c.patientId) ? { ...c, patientId: keepId } : c,
    ),
    approvals: data.approvals.map((a) =>
      drops.has(a.patientId) ? { ...a, patientId: keepId } : a,
    ),
    declines: data.declines.map((d) =>
      d.patientId && drops.has(d.patientId) ? { ...d, patientId: keepId } : d,
    ),
    memos: (data.memos ?? []).map((m) =>
      drops.has(m.patientId) ? { ...m, patientId: keepId } : m,
    ),
    importHistory: (data.importHistory ?? []).map((h) =>
      h.patientId && drops.has(h.patientId) ? { ...h, patientId: keepId } : h,
    ),
  };
}
