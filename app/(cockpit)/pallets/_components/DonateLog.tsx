import type { DonatedBook } from '@/lib/pallets/types'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

const TIER_LABEL: Record<string, string> = {
  COLLECTIBLE: 'COLL',
  HIGH_DEMAND: 'HD',
  STANDARD: 'STD',
}

export function DonateLog({ books }: { books: DonatedBook[] }) {
  if (books.length === 0) return null

  return (
    <div className="border-border bg-cockpit-surface rounded-[6px] border p-5">
      <div className="mb-3">
        <span className="text-muted-foreground block text-xs font-semibold tracking-[0.08em] uppercase">
          Donate Log
        </span>
        <p className="text-muted-foreground mt-1 text-xs">
          {books.length} book{books.length !== 1 ? 's' : ''} marked for donation
        </p>
      </div>
      <div className="flex flex-col gap-1">
        {books.map((book) => (
          <div key={book.id} className="flex items-center gap-2 py-0.5">
            <span className="text-muted-foreground w-12 shrink-0 font-mono text-[10px]">
              {fmtDate(book.created_at)}
            </span>
            {book.tier && (
              <span className="rounded-sm bg-[var(--color-overlay)] px-1 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                {TIER_LABEL[book.tier] ?? book.tier}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-primary)]">
              {book.title ?? book.isbn}
              {book.author && <span className="text-muted-foreground"> · {book.author}</span>}
            </span>
            <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
              ${book.cost_paid_cad.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
