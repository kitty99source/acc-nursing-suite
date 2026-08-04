import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AiChatMarkdown } from './AiChatMarkdown';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AiChatMarkdown', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function mount(content: string) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<AiChatMarkdown content={content} />);
    });
  }

  it('renders headings, lists, and links with suite-friendly markup', () => {
    mount(
      [
        '## NS04 summary',
        '',
        '- Prior approval required',
        '- Cap applies',
        '',
        'See [ACC](https://www.acc.co.nz) for the published schedule.',
      ].join('\n'),
    );
    expect(container.querySelector('h2')?.textContent).toBe('NS04 summary');
    expect(container.textContent).toContain('Prior approval required');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://www.acc.co.nz');
    expect(link?.textContent).toBe('ACC');
  });

  it('renders GFM tables inside a horizontally scrollable wrapper', () => {
    mount(['| Code | Rate |', '| --- | --- |', '| NS04 | $85.50 |'].join('\n'));
    expect(container.querySelector('.ai-md-table-wrap')).toBeTruthy();
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('NS04');
    expect(container.textContent).toContain('$85.50');
  });

  it('renders fenced code blocks without inventing purple styling classes', () => {
    mount('```\nconst x = 1;\n```');
    const pre = container.querySelector('pre.ai-md-pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain('const x = 1');
    expect(container.innerHTML).not.toMatch(/purple|indigo|violet/i);
  });
});
