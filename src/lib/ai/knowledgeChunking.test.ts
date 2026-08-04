import { describe, expect, it } from 'vitest';
import { chunkDocumentText } from './knowledgeChunking';

describe('chunkDocumentText — table-of-contents exclusion (2026-08-04 context-overflow fix)', () => {
  it('excludes a leader-dot table-of-contents page from the output entirely', () => {
    const tocPage =
      'Table of Contents Useful Contact Information ' +
      '........................................................................................... 1 ' +
      'Useful Links .................................................................................................................. 2 ' +
      '1. Introduction ........................................................................................... 4 ' +
      '2. Who can hold this Contract? ................................................................................... 4 ' +
      '3. What does the contract cover? ............................................................................... 5';
    const substantivePara =
      'The Assessment Report and Treatment Plan (ARTP) is the process by which a surgeon requests ' +
      'prior approval from ACC for a contracted elective surgery procedure before it can proceed.';
    const text = [tocPage, substantivePara].join('\n\n');

    const chunks = chunkDocumentText('doc-with-toc', text, { maxChars: 300, minChars: 10 });

    expect(chunks.some((c) => c.text.includes('Table of Contents'))).toBe(false);
    expect(chunks.some((c) => c.text.includes('ARTP'))).toBe(true);
  });

  it('re-indexes remaining chunks sequentially with no gaps after excluding a ToC page', () => {
    const tocPage =
      'Table of Contents Section One .......................................................................... 1 ' +
      'Section Two .................................................................................................... 2 ' +
      'Section Three ................................................................................................ 3 ' +
      'Section Four .................................................................................................. 4 ' +
      'Section Five ................................................................................................... 5';
    const paras = [tocPage, 'First real paragraph about nursing packages.', 'Second real paragraph about extended nursing.'];
    const chunks = chunkDocumentText('doc-b', paras.join('\n\n'), { maxChars: 60, minChars: 5 });

    expect(chunks.every((c) => !c.text.includes('Table of Contents'))).toBe(true);
    chunks.forEach((c, i) => {
      expect(c.chunkIndex).toBe(i);
      expect(c.id).toBe(`doc-b#${i}`);
    });
  });

  it('never excludes ordinary narrative content with no leader-dot pattern', () => {
    const text = 'A reasonably long paragraph about nursing packages and consultations, with no dot leaders at all.';
    const chunks = chunkDocumentText('doc-c', text, { maxChars: 5000, minChars: 10 });
    expect(chunks).toHaveLength(1);
  });
});
