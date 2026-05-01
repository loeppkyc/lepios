'use client'

/*
 * Library decision (orb-A5, 2026-04-27 → 2026-04-28):
 *
 * Stack: react-markdown@10 + remark-gfm@4 + rehype-pretty-code@0.14 + shiki@4.
 *
 * Why rehype-pretty-code over direct shiki: cleaner integration as a standard
 * rehype plugin in the react-markdown chain — no custom async useEffect or
 * dangerouslySetInnerHTML required. rehype-pretty-code handles the shiki
 * highlighter lifecycle and caching internally.
 *
 * Why rehype-pretty-code + shiki over rehype-highlight (highlight.js):
 *   - shiki uses TextMate grammars (same engine as VS Code) — output quality
 *     is materially better than highlight.js
 *   - rehype-pretty-code emits inline color styles per token (library-generated,
 *     not authored TSX — F20 still satisfied)
 *   - bundle: shiki bundled themes + a dozen common languages = ~400 KB
 *     gzipped, route-split to /chat only via Next.js code splitting.
 *     rehype-highlight + highlight.js was ~150 KB but visibly worse.
 *
 * Streaming caveat: shiki is async under the hood. During streaming, a
 * mid-fence code block may briefly show as raw text before highlighting
 * resolves on the next async cycle. Acceptable per orb-A5.md §2.
 */

import { useRef, useState } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypePrettyCode from 'rehype-pretty-code'

type PreWithLang = ComponentPropsWithoutRef<'pre'> & { 'data-language'?: string }

function CodeBlock({ children, 'data-language': language, ...rest }: PreWithLang) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  function copy() {
    const text = preRef.current?.innerText ?? ''
    if (!text) return
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="my-4 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
        <span className="font-[family-name:var(--font-mono)] text-[length:var(--text-nano)] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          {language ?? 'code'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-wide text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        ref={preRef}
        {...rest}
        className="overflow-x-auto bg-[var(--color-base)] p-4 font-[family-name:var(--font-mono)] text-sm leading-relaxed [&>code]:bg-transparent [&>code]:p-0"
      >
        {children}
      </pre>
    </div>
  )
}

function InlineOrBlockCode({ children, className, ...rest }: ComponentPropsWithoutRef<'code'>) {
  // Block code from rehype-pretty-code arrives with a className (language-* or shiki tokens);
  // inline code has no className. Pass block code through untouched so the parent <pre>
  // wrapper handles framing; style only true inline code.
  if (className) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  }
  return (
    <code className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-px font-[family-name:var(--font-mono)] text-[length:var(--text-small)] text-[var(--color-text-muted)]">
      {children}
    </code>
  )
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="prose-orb min-w-0 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypePrettyCode, { theme: 'github-dark', keepBackground: false }]]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-5 font-[family-name:var(--font-ui)] text-lg font-bold text-[var(--color-text)] first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 font-[family-name:var(--font-ui)] text-base font-bold text-[var(--color-text)] first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 font-[family-name:var(--font-ui)] text-sm font-semibold text-[var(--color-text)] first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1 mt-2 font-[family-name:var(--font-ui)] text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)] first:mt-0">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="mb-1 mt-2 font-[family-name:var(--font-ui)] text-sm font-medium text-[var(--color-text-muted)] first:mt-0">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="mb-1 mt-2 font-[family-name:var(--font-ui)] text-xs font-medium text-[var(--color-text-disabled)] first:mt-0">
              {children}
            </h6>
          ),
          p: ({ children }) => (
            <p className="mb-3 leading-relaxed text-[var(--color-text)] last:mb-0">{children}</p>
          ),
          code: InlineOrBlockCode,
          pre: CodeBlock as (props: ComponentPropsWithoutRef<'pre'>) => React.JSX.Element,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-border)]">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-[var(--color-border)] last:border-0">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="px-3 py-2 text-[var(--color-text)]">{children}</td>,
          ul: ({ children }) => (
            <ul className="mb-3 list-disc pl-5 text-[var(--color-text)] [&>li]:mb-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal pl-5 text-[var(--color-text)] [&>li]:mb-1">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-[var(--color-accent)] pl-4 italic text-[var(--color-text-muted)]">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-t border-[var(--color-border)]" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
