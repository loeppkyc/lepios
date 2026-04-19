import Link from 'next/link'

export default function CockpitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--color-border)',
          padding: '0 16px',
          background: 'var(--color-base)',
        }}
      >
        {[
          { href: '/scan', label: 'Scan' },
          { href: '/hit-lists', label: 'Lists' },
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
              padding: '10px 14px',
              display: 'inline-block',
              transition: 'color var(--transition-fast)',
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
