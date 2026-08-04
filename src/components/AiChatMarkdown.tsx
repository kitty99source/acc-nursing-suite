import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

// ============================================================================
// Compact Cursor-like markdown rendering for AI chat assistant bubbles.
// Uses suite CSS tokens (not purple AI-slop). Tables scroll horizontally when
// wide. User messages stay plain text in AiChatPanel — this is for assistant
// answers only. Reasoning dumps stay in <pre>, not through this component.
// ============================================================================

const components: Components = {
  h1: ({ children }) => (
    <h1 className="ai-md-h1 text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="ai-md-h2 text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="ai-md-h3 text-xs font-semibold mt-1.5 mb-0.5 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="ai-md-h4 text-xs font-semibold mt-1.5 mb-0.5 first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="ai-md-p my-1 first:mt-0 last:mb-0 leading-snug">{children}</p>,
  ul: ({ children }) => <ul className="ai-md-ul my-1 pl-4 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="ai-md-ol my-1 pl-4 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="ai-md-li leading-snug">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="ai-md-a underline break-words"
      style={{ color: 'var(--accent)' }}
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === 'string' && /language-/.test(className);
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="ai-md-code-inline px-1 py-0.5 rounded text-[0.85em]"
        style={{ background: 'var(--surface)', color: 'var(--text)' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      className="ai-md-pre my-1.5 p-2 rounded text-[11px] overflow-x-auto whitespace-pre"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
    >
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="ai-md-table-wrap my-1.5 overflow-x-auto max-w-full" style={{ border: '1px solid var(--border)', borderRadius: 4 }}>
      <table className="ai-md-table text-[11px] w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: 'var(--surface)' }}>{children}</thead>
  ),
  th: ({ children }) => (
    <th
      className="px-2 py-1 text-left font-semibold whitespace-nowrap"
      style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      className="px-2 py-1 align-top"
      style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}
    >
      {children}
    </td>
  ),
  blockquote: ({ children }) => (
    <blockquote
      className="ai-md-blockquote my-1 pl-2 border-l-2"
      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2" style={{ borderColor: 'var(--border)' }} />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
};

export interface AiChatMarkdownProps {
  content: string;
  className?: string;
}

/** Renders assistant markdown with GFM (tables, strikethrough, autolinks). */
export function AiChatMarkdown({ content, className }: AiChatMarkdownProps) {
  return (
    <div className={className ? `ai-chat-md ${className}` : 'ai-chat-md'} data-testid="ai-chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
