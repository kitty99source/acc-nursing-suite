import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { FAQ_ENTRIES, GUIDE_SECTIONS, filterFaq, type FaqEntry } from '../lib/helpContent';

export type HelpTab = 'guide' | 'faq';

function FaqItem({ entry }: { entry: FaqEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-card border overflow-hidden"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <button
        type="button"
        className="w-full text-left px-3 py-2.5 flex items-start gap-2"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs shrink-0 mt-0.5" style={{ color: 'var(--muted)' }} aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="text-sm font-semibold">{entry.question}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pl-7 text-sm" style={{ color: 'var(--text)' }}>
          {entry.answer}
        </div>
      )}
    </div>
  );
}

export function HelpCenterModal({
  open,
  initialTab = 'guide',
  onClose,
}: {
  open: boolean;
  initialTab?: HelpTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<HelpTab>(initialTab);
  const [faqQuery, setFaqQuery] = useState('');

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setFaqQuery('');
    }
  }, [open, initialTab]);

  if (!open) return null;

  const faqVisible = filterFaq(FAQ_ENTRIES, faqQuery);

  return (
    <Modal
      open
      title="Help Center"
      onClose={onClose}
      size="xl"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          A short walkthrough of each area of the suite, plus answers to common questions. You can reopen this
          any time from the Help button in the top bar or from Settings.
        </p>

        <div
          role="tablist"
          aria-label="Help sections"
          className="flex gap-1 p-1 rounded-card"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'guide'}
            className="btn btn-sm flex-1"
            style={
              tab === 'guide'
                ? undefined
                : { background: 'transparent', border: '1px solid transparent' }
            }
            onClick={() => setTab('guide')}
          >
            Guide
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'faq'}
            className="btn btn-sm flex-1"
            style={
              tab === 'faq'
                ? undefined
                : { background: 'transparent', border: '1px solid transparent' }
            }
            onClick={() => setTab('faq')}
          >
            FAQ
          </button>
        </div>

        {tab === 'guide' && (
          <div className="space-y-3" role="tabpanel">
            {GUIDE_SECTIONS.map((section) => (
              <div
                key={section.id}
                className="rounded-card border p-3"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
              >
                <h3 className="text-sm font-bold mb-1.5">{section.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
                  {section.body}
                </p>
              </div>
            ))}
          </div>
        )}

        {tab === 'faq' && (
          <div className="space-y-3" role="tabpanel">
            <label className="block">
              <span className="sr-only">Search FAQ</span>
              <input
                type="search"
                className="input w-full"
                placeholder="Search FAQ (e.g. quiet, undo, backup)…"
                value={faqQuery}
                onChange={(e) => setFaqQuery(e.target.value)}
              />
            </label>
            {faqVisible.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                No FAQ entries match that search.
              </p>
            ) : (
              <div className="space-y-2">
                {faqVisible.map((entry) => (
                  <FaqItem key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
