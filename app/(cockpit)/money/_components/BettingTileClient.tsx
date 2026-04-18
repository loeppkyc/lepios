'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogBetForm } from './LogBetForm'
import { SettleBetForm } from './SettleBetForm'
import { rollingRoiSignal, SIGNAL_WINDOW, type EdgeSignal } from '@/lib/betting-signals'

interface Bet {
  id: string
  bet_date: string
  sport: string | null
  league: string | null
  bet_on: string | null
  bet_type: string | null
  odds: number | null
  stake: number | null
  result: string
  pnl: number | null
  bankroll_before: number | null
  kelly_pct: number | null
  book: string | null
}

interface BettingTileClientProps {
  pending: Bet[]
  completed30: Bet[]
  settledCount: number
  totalPnl: number
  wins: number
  losses: number
}

const SIGNAL_COLOR: Record<EdgeSignal, string> = {
  PROFITABLE: 'var(--color-positive)',
  'BREAK-EVEN': 'var(--color-warning)',
  LOSING: 'var(--color-critical)',
}

function EdgeSignalBadge({ settled, bets }: { settled: number; bets: Bet[] }) {
  if (settled < SIGNAL_WINDOW) {
    return (
      <span
        data-testid="edge-signal"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        Collecting data ({settled}/{SIGNAL_WINDOW})
      </span>
    )
  }

  const signal = rollingRoiSignal(bets)
  return (
    <span
      data-testid="edge-signal"
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-small)',
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: SIGNAL_COLOR[signal],
      }}
    >
      {signal}
    </span>
  )
}

export function BettingTileClient({
  pending,
  completed30,
  settledCount,
  totalPnl,
  wins,
  losses,
}: BettingTileClientProps) {
  const router = useRouter()
  const [showLogForm, setShowLogForm] = useState(false)
  const [settlingId, setSettlingId] = useState<string | null>(null)

  const winRate = settledCount > 0 ? wins / settledCount : null
  const rolling30Roi =
    completed30.length > 0
      ? completed30.reduce((s, b) => s + (b.pnl ?? 0), 0) /
        Math.max(completed30.reduce((s, b) => s + (b.stake ?? 0), 0), 0.01)
      : 0

  function handleSuccess() {
    setShowLogForm(false)
    setSettlingId(null)
    router.refresh()
  }

  return (
    <div data-testid="betting-tile">
      {/* ── Tile header ─────────────────────────────────────────────── */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="label-caps">Betting</span>
          <EdgeSignalBadge settled={settledCount} bets={completed30} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {settledCount > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-small)',
                color: rolling30Roi >= 0 ? 'var(--color-positive)' : 'var(--color-critical)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {rolling30Roi >= 0 ? '+' : ''}
              {(rolling30Roi * 100).toFixed(1)}% ROI
            </span>
          )}

          <button
            data-testid="log-bet-toggle"
            onClick={() => setShowLogForm((v) => !v)}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: showLogForm ? 'var(--color-base)' : 'var(--color-accent-gold)',
              backgroundColor: showLogForm ? 'var(--color-accent-gold)' : 'transparent',
              border: '1px solid var(--color-accent-gold)',
              borderRadius: 'var(--radius-md)',
              padding: '4px 12px',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >
            {showLogForm ? 'Cancel' : '+ Log Bet'}
          </button>
        </div>
      </div>

      {/* ── Log Bet form ─────────────────────────────────────────────── */}
      {showLogForm && (
        <div style={{ padding: '0 20px 16px' }}>
          <LogBetForm onSuccess={handleSuccess} />
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {pending.length === 0 && settledCount === 0 && !showLogForm && (
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-muted)',
            }}
          >
            No bets yet — log your first bet to start tracking
          </div>
        </div>
      )}

      {/* ── Pending bets ─────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <div>
          <div
            style={{
              padding: '8px 20px 4px',
              borderBottom: '1px solid var(--color-border-pillar)',
            }}
          >
            <span
              className="label-caps"
              style={{ color: 'var(--color-warning)', fontSize: 'var(--text-nano)' }}
            >
              Pending ({pending.length})
            </span>
          </div>

          {pending.map((bet, i) => (
            <div key={bet.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 20px',
                  borderBottom:
                    i < pending.length - 1 || settledCount > 0
                      ? '1px solid var(--color-border-pillar)'
                      : undefined,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-muted)',
                    width: 76,
                    flexShrink: 0,
                  }}
                >
                  {bet.bet_date}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-body)',
                    color: 'var(--color-text-primary)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {bet.sport && `${bet.sport} · `}
                  {bet.bet_on ?? '—'}
                  {bet.bet_type && (
                    <span
                      style={{ color: 'var(--color-text-muted)', marginLeft: 6, fontSize: 'var(--text-small)' }}
                    >
                      {bet.bet_type}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-secondary)',
                    fontVariantNumeric: 'tabular-nums',
                    width: 48,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {bet.odds != null ? (bet.odds > 0 ? `+${bet.odds}` : `${bet.odds}`) : '—'}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                    width: 48,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  ${bet.stake?.toFixed(2) ?? '—'}
                </span>
                {bet.kelly_pct != null && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                      width: 52,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}
                  >
                    {bet.kelly_pct.toFixed(1)}% K
                  </span>
                )}
                <button
                  onClick={() => setSettlingId(settlingId === bet.id ? null : bet.id)}
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-muted)',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-border-accent)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '3px 10px',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Settle
                </button>
              </div>

              {settlingId === bet.id && (
                <div style={{ padding: '0 20px 12px' }}>
                  <SettleBetForm
                    betId={bet.id}
                    stake={bet.stake}
                    onSuccess={handleSuccess}
                    onCancel={() => setSettlingId(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Completed stats ───────────────────────────────────────────── */}
      {settledCount > 0 && (
        <div
          style={{
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            borderTop: pending.length > 0 ? '1px solid var(--color-border)' : undefined,
          }}
        >
          <div>
            <div
              className="label-caps"
              style={{ fontSize: 'var(--text-nano)', marginBottom: 2 }}
            >
              Record
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-body)',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {wins}–{losses}
            </span>
          </div>

          <div>
            <div
              className="label-caps"
              style={{ fontSize: 'var(--text-nano)', marginBottom: 2 }}
            >
              Win rate
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-body)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color:
                  winRate == null
                    ? 'var(--color-text-muted)'
                    : winRate >= 0.55
                      ? 'var(--color-positive)'
                      : winRate < 0.45
                        ? 'var(--color-critical)'
                        : 'var(--color-text-secondary)',
              }}
            >
              {winRate != null ? `${(winRate * 100).toFixed(0)}%` : '—'}
            </span>
          </div>

          <div>
            <div
              className="label-caps"
              style={{ fontSize: 'var(--text-nano)', marginBottom: 2 }}
            >
              Season P&amp;L
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-body)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color:
                  totalPnl > 0
                    ? 'var(--color-positive)'
                    : totalPnl < 0
                      ? 'var(--color-critical)'
                      : 'var(--color-text-secondary)',
              }}
            >
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </span>
          </div>

          <div>
            <div
              className="label-caps"
              style={{ fontSize: 'var(--text-nano)', marginBottom: 2 }}
            >
              Rolling 30 ROI
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-body)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color:
                  rolling30Roi > 0.03
                    ? 'var(--color-positive)'
                    : rolling30Roi < -0.03
                      ? 'var(--color-critical)'
                      : 'var(--color-text-secondary)',
              }}
            >
              {rolling30Roi >= 0 ? '+' : ''}
              {(rolling30Roi * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
