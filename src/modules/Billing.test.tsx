import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

// React 18 requires this flag for act(...) to drive effects in a test env.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';

import { Billing } from './Billing';
import { useStore } from '../state/store';
import { emptyData } from '../lib/sampleData';

vi.mock('../lib/auditLog', () => ({
  appendAudit: vi.fn(async () => {}),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.setState({ data: emptyData() });
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

// Simulates picking an unrecognisable file via the given hidden <input type=file>,
// the same way the browser would populate `input.files` before firing `change`.
async function uploadFile(input: HTMLInputElement, fileName: string, contents: string) {
  const file = new File([contents], fileName, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('<Billing /> import log dismiss', () => {
  it('shows a Dismiss button for a failed invoice-schedule import and clears it on click', async () => {
    act(() => {
      root.render(<Billing />);
    });

    const scheduleInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(scheduleInput).toBeTruthy();
    await uploadFile(scheduleInput, 'garbage.csv', 'foo,bar\n1,2\n');
    await flush();

    expect(container.textContent).toContain("Couldn't find a claim-number and amount column");
    clickButtonByText('Dismiss');
    await flush();

    expect(container.textContent).not.toContain("Couldn't find a claim-number and amount column");
  });

  it('shows a Dismiss button for a failed remittance import and clears it on click', async () => {
    act(() => {
      root.render(<Billing />);
    });

    const fileInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    const remittanceInput = fileInputs[1];
    expect(remittanceInput).toBeTruthy();
    await uploadFile(remittanceInput, 'garbage.csv', 'foo,bar\n1,2\n');
    await flush();

    expect(container.textContent).toContain('no claim-number + paid-amount block was found');
    clickButtonByText('Dismiss');
    await flush();

    expect(container.textContent).not.toContain('no claim-number + paid-amount block was found');
  });
});
