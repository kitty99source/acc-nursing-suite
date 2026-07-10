import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import { PdfPreview } from './PdfPreview';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n%%EOF');

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('<PdfPreview /> content-sniffing fallback', () => {
  it('renders the PDF iframe for a nameless/typeless blob whose bytes are a real PDF', async () => {
    // Regression for the reported bug: bridge-resolved file arrives as a
    // GUID-named, application/octet-stream blob, but the bytes are a real
    // PDF — name/mime heuristics alone can't tell, so sniffing must kick in.
    const file = new File([PDF_BYTES], '2d5d827c-94cd-46f7-8e3e-0ba051001379', {
      type: 'application/octet-stream',
    });

    await act(async () => {
      root.render(<PdfPreview file={file} title="Approval letter" />);
    });
    await flush();
    await flush();

    expect(container.querySelector('iframe')).toBeTruthy();
    expect(container.textContent).not.toContain('Preview not available');
  });

  it('gives the "Download attachment" fallback link a .pdf extension for a sniffed-but-nameless PDF', async () => {
    // Even in the (rare) CSP-blocked-iframe fallback path, a nameless/typeless
    // blob that sniffs as PDF must download with a real .pdf extension —
    // never the bare GUID the OS can't open with the right app by default.
    const file = new File([PDF_BYTES], '2d5d827c-94cd-46f7-8e3e-0ba051001379', {
      type: 'application/octet-stream',
    });

    await act(async () => {
      root.render(<PdfPreview file={file} title="Approval letter" />);
    });
    await flush();
    await flush();
    expect(container.querySelector('iframe')).toBeTruthy();

    await act(async () => {
      // jsdom doesn't implement SecurityPolicyViolationEvent — a plain Event
      // with the same fields PdfPreview reads is enough to drive its handler.
      const violation = new Event('securitypolicyviolation') as Event & {
        effectiveDirective?: string;
        violatedDirective?: string;
        blockedURI?: string;
      };
      violation.effectiveDirective = 'frame-src';
      violation.blockedURI = 'blob';
      document.dispatchEvent(violation);
    });
    await flush();

    const link = container.querySelector('a[download]');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('download')).toBe('2d5d827c-94cd-46f7-8e3e-0ba051001379.pdf');
  });

  it('does not misdetect plain, non-PDF/zip bytes as a PDF', async () => {
    const file = new File([new TextEncoder().encode('plain text content')], 'notes', {
      type: 'application/octet-stream',
    });

    await act(async () => {
      root.render(<PdfPreview file={file} title="Some attachment" />);
    });
    await flush();
    await flush();

    expect(container.querySelector('iframe')).toBeFalsy();
    const link = container.querySelector('a[download]');
    expect(link).toBeTruthy();
    // Unknown kind — filename is left as-is (no extension to guess).
    expect(link!.getAttribute('download')).toBe('notes');
  });

  it('never drops a real extension already present on the file name', async () => {
    const file = new File([PDF_BYTES], 'letter.pdf', { type: 'application/pdf' });

    await act(async () => {
      root.render(<PdfPreview file={file} title="Approval letter" />);
    });
    await flush();

    expect(container.querySelector('iframe')).toBeTruthy();
  });
});
