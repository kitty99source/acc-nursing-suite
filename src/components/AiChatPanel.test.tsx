import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';

import { AiChatPanel } from './AiChatPanel';
import { useStore } from '../state/store';
import { useAiChatStore } from '../state/aiChatStore';
import { emptyData } from '../lib/sampleData';
import type { AiGenerateResult } from '../lib/aiService';

const generateMock = vi.fn<[], Promise<AiGenerateResult>>();
vi.mock('../lib/aiService', async () => {
  const actual = await vi.importActual<typeof import('../lib/aiService')>('../lib/aiService');
  return { ...actual, generateLocalAiResponse: (...args: unknown[]) => generateMock(...(args as [])) };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.setState({ data: { ...emptyData(), settings: { ...emptyData().settings, aiFeaturesEnabled: true } } });
  useAiChatStore.setState({ open: false, chips: [], messages: [], sending: false });
  generateMock.mockReset();
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

function render() {
  act(() => {
    root.render(<AiChatPanel />);
  });
}

describe('AiChatPanel', () => {
  it('renders nothing when AI features are disabled in Settings', () => {
    useStore.setState({ data: { ...emptyData(), settings: { ...emptyData().settings, aiFeaturesEnabled: false } } });
    render();
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders a collapsed bubble by default when AI features are enabled', () => {
    render();
    const bubble = container.querySelector('button[aria-label="Open AI assistant"]');
    expect(bubble).toBeTruthy();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('expands into the chat window when the bubble is clicked, and can be minimized again', () => {
    render();
    const bubble = container.querySelector('button[aria-label="Open AI assistant"]') as HTMLButtonElement;
    act(() => bubble.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.textContent).toContain('Runs 100% locally');

    const minimize = container.querySelector('button[aria-label="Minimize"]') as HTMLButtonElement;
    act(() => minimize.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows attached chips and removes one when its X is clicked', () => {
    useAiChatStore.getState().addChip({ id: 'patient:p1', type: 'patient', recordId: 'p1', label: 'Jane Doe' });
    useAiChatStore.setState({ open: true });
    render();
    expect(container.textContent).toContain('Jane Doe');

    const removeBtn = container.querySelector('button[aria-label="Remove Jane Doe from context"]') as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();
    act(() => removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useAiChatStore.getState().chips).toHaveLength(0);
  });

  it('sends a message, shows the user bubble, then the assistant reply from the (mocked) local model', async () => {
    generateMock.mockResolvedValue({ ok: true, text: 'The claim looks active.' });
    useAiChatStore.setState({ open: true });
    render();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      nativeSetter.call(textarea, "What's the status?");
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendBtn = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    act(() => sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(container.textContent).toContain("What's the status?");
    expect(container.textContent).toContain('The claim looks active.');
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('shows a graceful error bubble when the local model is unavailable', async () => {
    generateMock.mockResolvedValue({ ok: false, error: 'Failed to fetch' });
    useAiChatStore.setState({ open: true });
    render();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      nativeSetter.call(textarea, 'Hello?');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendBtn = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    act(() => sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(container.textContent).toContain("Couldn't reach the local AI model");
    expect(container.textContent).toContain('Failed to fetch');
  });

  it('"New chat" clears the conversation', async () => {
    useAiChatStore.getState().addMessage({ id: 'm1', role: 'user', content: 'old message', createdAt: Date.now() });
    useAiChatStore.setState({ open: true });
    render();
    expect(container.textContent).toContain('old message');

    const newChatBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'New');
    act(() => newChatBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).not.toContain('old message');
  });
});
