import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

// React 18 requires this flag for act(...) to drive effects in a test env.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';

import { Approvals } from './Approvals';
import { useStore } from '../state/store';
import { emptyData } from '../lib/sampleData';
import type { Approval, Claim, Patient } from '../types';

let container: HTMLDivElement;
let root: Root;

const patient: Patient = { id: 'p1', name: 'Jane Doe', nhi: 'ABC1234', dob: '1990-01-01', notes: '' };
const claim: Claim = {
  id: 'c1',
  patientId: 'p1',
  claimNumber: '10000000123',
  acc45Number: 'YN00000',
  poNumber: '12345678',
  injuryDescription: 'Sprain',
  type: 'original',
  status: 'active',
  day1Date: '2024-01-01',
};
const manualApproval: Approval = {
  id: 'a-manual',
  patientId: 'p1',
  claimId: 'c1',
  serviceCode: 'NS04',
  approvalStartDate: '2024-01-01',
  approvalEndDate: '2099-01-01',
  approvedHoursOrConsults: 10,
  poNumber: '12345678',
  notes: '',
};
const autoApproval: Approval = {
  id: 'a-auto',
  patientId: 'p1',
  claimId: 'c1',
  serviceCode: 'NS05',
  approvalStartDate: '2024-02-01',
  approvalEndDate: '2099-02-01',
  approvedHoursOrConsults: 5,
  poNumber: '12345678',
  notes: '',
  autoAccepted: true,
  autoAcceptedAt: Date.now(),
};

beforeEach(() => {
  useStore.setState({
    data: {
      ...emptyData(),
      patients: [patient],
      claims: [claim],
      approvals: [manualApproval, autoApproval],
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function badgeTexts(): string[] {
  return Array.from(container.querySelectorAll('.badge')).map((el) => el.textContent ?? '');
}

describe('<Approvals /> auto-accepted badge + filter', () => {
  it('shows the Auto-accepted badge only next to the record created via auto-accept', () => {
    act(() => {
      root.render(<Approvals />);
    });
    const badges = badgeTexts();
    expect(badges.filter((t) => t === 'Auto-accepted')).toHaveLength(1);
    // Both rows still render by default ("All approvals").
    expect(container.textContent).toContain('NS04');
    expect(container.textContent).toContain('NS05');
  });

  it('filters to only auto-accepted approvals when "Auto-accepted only" is selected', () => {
    act(() => {
      root.render(<Approvals />);
    });
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by auto-accepted"]');
    expect(select).toBeTruthy();

    act(() => {
      select!.value = 'auto';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Only the auto-accepted NS05 row remains; the manual NS04 row is filtered out.
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(badgeTexts().filter((t) => t === 'Auto-accepted')).toHaveLength(1);
  });

  it('does not show the auto-accepted filter control when there are no auto-accepted approvals', () => {
    useStore.setState({
      data: {
        ...emptyData(),
        patients: [patient],
        claims: [claim],
        approvals: [manualApproval],
      },
    });
    act(() => {
      root.render(<Approvals />);
    });
    expect(container.querySelector('select[aria-label="Filter by auto-accepted"]')).toBeNull();
    expect(badgeTexts().filter((t) => t === 'Auto-accepted')).toHaveLength(0);
  });
});
