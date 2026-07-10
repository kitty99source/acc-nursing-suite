import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

// React 18 requires this flag for act(...) to drive effects in a test env.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';

import { Patients } from './Patients';
import { useStore } from '../state/store';
import { emptyData } from '../lib/sampleData';
import type { Patient } from '../types';

vi.mock('../lib/auditLog', () => ({
  appendAudit: vi.fn(async () => {}),
}));

let container: HTMLDivElement;
let root: Root;

const patient: Patient = { id: 'p1', name: 'Jane Doe', nhi: 'ABC1234', dob: '1990-01-01', notes: '' };

beforeEach(() => {
  useStore.setState({
    data: {
      ...emptyData(),
      patients: [patient],
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickButtonByText(text: string) {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  expect(btn).toBeTruthy();
  act(() => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

// React tracks controlled-input values via a property setter on the prototype;
// assigning `.value` directly bypasses it, so React never sees the change.
// Go through the native setter (the standard jsdom/React testing workaround)
// so the subsequent 'input' event actually reaches the component's onChange.
function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('<Patients /> memo panel', () => {
  it('adds a memo via the quick-entry form and shows it as unresolved', async () => {
    act(() => {
      root.render(<Patients />);
    });

    clickButtonByText('Add memo');
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).toBeTruthy();

    act(() => {
      typeInto(textarea!, 'Please confirm dressing change schedule.');
    });
    clickButtonByText('Save memo');
    await flush();

    expect(useStore.getState().data.memos).toHaveLength(1);
    expect(useStore.getState().data.memos[0].text).toBe('Please confirm dressing change schedule.');
    expect(container.textContent).toContain('Please confirm dressing change schedule.');
    expect(container.textContent).toContain('Unresolved');
  });

  it('marks a memo resolved and updates the count', async () => {
    useStore.getState().addMemo({ patientId: 'p1', text: 'Follow up on wound care.' });
    act(() => {
      root.render(<Patients />);
    });
    expect(container.textContent).toContain('1, 1 unresolved');

    clickButtonByText('Mark resolved');
    await flush();

    const memo = useStore.getState().data.memos[0];
    expect(memo.resolved).toBe(true);
    expect(memo.resolvedAt).toBeTypeOf('number');
    expect(container.textContent).toContain('Resolved');
  });

  it('removes a patient and cascades to delete their memos', () => {
    useStore.getState().addMemo({ patientId: 'p1', text: 'Ask about pain levels.' });
    expect(useStore.getState().data.memos).toHaveLength(1);

    useStore.getState().removePatient('p1');

    expect(useStore.getState().data.memos).toHaveLength(0);
  });
});
