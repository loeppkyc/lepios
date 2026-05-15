'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatAmerican, americanToImpliedProb } from '@/lib/sports/odds'
import { eloEdge } from '@/lib/sports/elo'
import type { Game } from '@/lib/sports/odds'
import type { SportsPick } from '@/lib/sports/picks'
import type { EloRating } from '@/lib/sports/elo'
import type { DebriefResult } from '@/lib/sports/debrief'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OddsResponse {
  games: Game[]
  total: number
  favorites: number
  is_demo: boolean
}

interface ApiStatus {
  status: string
  message: string
  remaining?: string
}

interface EloResponse {
  ratings: EloRating[]
  sport: string
  count: number
}

interface GateProgress {
  sample_size: number
  sample_size_target: number
  win_rate: number | null
  win_rate_target: number
  roi: number | null
  roi_target: number
  drawdown: number | null
  drawdown_target: number
}

interface GateEntry {
  current_mode: string
  gate_status: string
  progress: GateProgress
  thresholds: {
    min_sample_size: number
    win_rate_threshold: number
    secondary_metric_key: string
    secondary_metric_threshold: number
    max_drawdown_threshold: number
  }
  last_recomputed_at: string | null
  updated_at: string
}

interface GateResponse {
  gates: Record<string, GateEntry>
}

// ── ProgressBar ───────────────────────────────────────────────────────────────
// Uses data-pct attribute for visual reference; actual width set via CSS class bands
// (Tailwind can't purge arbitrary dynamic percentages, so we use stepped classes)

const PCT_BANDS = [0, 10, 20, 25, 30, 40, 50, 60, 67, 70, 75, 80, 90, 100] as const

function pctToClass(pct: number): string {
  const rounded = PCT_BANDS.reduce((prev, curr) =>
    Math.abs(curr - pct) < Math.abs(prev - pct) ? curr : prev
  )
  const map: Record<number, string> = {
    0: 'w-0',
    10: 'w-[10%]',
    20: 'w-1/5',
    25: 'w-1/4',
    30: 'w-[30%]',
    40: 'w-2/5',
    50: 'w-1/2',
    60: 'w-3/5',
    67: 'w-2/3',
    70: 'w-[70%]',
    75: 'w-3/4',
    80: 'w-4/5',
    90: 'w-[90%]',
    100: 'w-full',
  }
  return map[rounded] ?? 'w-1/2'
}

function ProgressBar({ value, max, met }: { value: number; max: number; met: boolean }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0)
  return (
    <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
      <div
        className={`h-2 rounded-full transition-all ${met ? 'bg-green-500' : 'bg-yellow-500'} ${pctToClass(pct)}`}
      />
    </div>
  )
}

// ── EloChip ───────────────────────────────────────────────────────────────────

function EloChip({ edge }: { edge: number }) {
  const pct = (edge * 100).toFixed(1)
  const positive = edge >= 0
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        positive ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'
      }`}
    >
      ELO: {positive ? '+' : ''}
      {pct}%
    </span>
  )
}

// ── Tab 1: Today's Games ──────────────────────────────────────────────────────

function TodaysGamesTab() {
  const [data, setData] = useState<OddsResponse | null>(null)
  const [status, setStatus] = useState<ApiStatus | null>(null)
  const [eloRatings, setEloRatings] = useState<EloRating[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState<'all' | 'favorites'>('all')
  const [sortBy, setSortBy] = useState<'odds' | 'elo_edge'>('odds')
  const [logging, setLogging] = useState(false)
  const [logMsg, setLogMsg] = useState('')

  useEffect(() => {
    fetch('/api/sports/odds?action=status')
      .then((r) => r.json())
      .then((s: ApiStatus) => setStatus(s))
      .catch(() => null)

    fetch('/api/sports/odds')
      .then((r) => r.json())
      .then((d: OddsResponse) => setData(d))
      .catch(() => null)
      .finally(() => setLoading(false))

    fetch('/api/sports/elo?sport=nhl&limit=40')
      .then((r) => r.json())
      .then((d: EloResponse) => setEloRatings(d.ratings ?? []))
      .catch(() => null)
  }, [])

  const eloByTeam = new Map(eloRatings.map((r) => [r.team, r.elo]))

  function getEloEdge(game: Game): number | null {
    if (game.sport_key !== 'icehockey_nhl') return null
    const homeElo = eloByTeam.get(game.home)
    const awayElo = eloByTeam.get(game.away)
    if (!homeElo || !awayElo) return null
    const marketImplied = americanToImpliedProb(game.home_odds) // home team market prob
    return eloEdge(homeElo, awayElo, marketImplied)
  }

  let displayed =
    filterMode === 'favorites'
      ? (data?.games ?? []).filter((g) => g.fav_odds <= -150)
      : (data?.games ?? [])

  if (sortBy === 'elo_edge') {
    displayed = [...displayed].sort((a, b) => {
      const eA = getEloEdge(a) ?? -999
      const eB = getEloEdge(b) ?? -999
      return eB - eA
    })
  }

  const greenCount = (data?.games ?? []).filter((g) => g.fav_odds <= -150).length

  function handleLogPicks() {
    if (!data?.games.length) return
    setLogging(true)
    fetch('/api/sports/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: data.games }),
    })
      .then((r) => r.json())
      .then((res: { logged: number }) => setLogMsg(`Logged ${res.logged} games`))
      .catch(() => setLogMsg('Log failed'))
      .finally(() => setLogging(false))
  }

  if (loading) return <p className="text-muted-foreground p-4 text-sm">Loading odds...</p>

  return (
    <div className="space-y-4">
      {/* Status bar */}
      {status && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Badge variant={status.status === 'ok' ? 'default' : 'destructive'}>
                {status.status === 'ok' ? 'API Live' : status.status}
              </Badge>
              <span className="text-muted-foreground text-xs">{status.message}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.is_demo && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
          Demo data — add ODDS_API_KEY to see live lines
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{data?.total ?? 0} games</Badge>
        <Badge className="bg-green-600 text-white">{greenCount} green picks</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Select value={filterMode} onValueChange={(v) => setFilterMode(v as 'all' | 'favorites')}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All games</SelectItem>
              <SelectItem value="favorites">Green only (-150)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'odds' | 'elo_edge')}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="odds">Sort: by odds</SelectItem>
              <SelectItem value="elo_edge">Sort: by Elo edge</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogPicks}
            disabled={logging || !data?.games.length}
          >
            {logging ? 'Logging...' : 'Log All Picks'}
          </Button>
        </div>
      </div>

      {logMsg && <p className="text-xs text-green-400">{logMsg}</p>}

      {/* Game cards */}
      <div className="space-y-2">
        {displayed.map((g) => {
          const edge = getEloEdge(g)
          return (
            <div
              key={g.game_id}
              className="bg-card/50 flex items-center justify-between rounded px-3 py-2.5 text-xs"
            >
              <div className="space-y-1">
                <div className="font-medium">
                  {g.home} vs {g.away}
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-1.5">
                  <span className={g.fav_odds <= -150 ? 'font-medium text-green-400' : ''}>
                    {g.favorite} {formatAmerican(g.fav_odds)}
                  </span>
                  <span className="text-muted-foreground/60">·</span>
                  <span>{g.implied_prob.toFixed(1)}% estimated implied</span>
                  <span className="text-muted-foreground/60">·</span>
                  <span>{g.commence_str}</span>
                  {edge !== null && <EloChip edge={edge} />}
                </div>
              </div>
              <div>
                {g.fav_odds <= -150 ? (
                  <Badge className="bg-green-600 text-[10px] text-white">green</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    red
                  </Badge>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!displayed.length && (
        <p className="text-muted-foreground py-8 text-center text-sm">No games found for today.</p>
      )}
    </div>
  )
}

// ── Tab 2: Picks Log ──────────────────────────────────────────────────────────

function PicksLogTab() {
  const [picks, setPicks] = useState<(SportsPick & { ai_debrief?: DebriefResult })[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toLocaleDateString('en-CA')
  })
  const [to, setTo] = useState(() => new Date().toLocaleDateString('en-CA'))

  const loadPicks = useCallback(() => {
    setLoading(true)
    fetch(`/api/sports/picks?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d: { picks: (SportsPick & { ai_debrief?: DebriefResult })[] }) => setPicks(d.picks))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPicks()
  }, [loadPicks])

  const statusBadge = (pick: SportsPick) => {
    if (pick.fav_won === true)
      return <Badge className="bg-green-600 text-[10px] text-white">Won</Badge>
    if (pick.fav_won === false)
      return (
        <Badge variant="destructive" className="text-[10px]">
          Lost
        </Badge>
      )
    return (
      <Badge variant="outline" className="text-[10px] text-yellow-400">
        Pending
      </Badge>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label className="text-xs">From</Label>
          <Input
            className="h-8 w-36 text-xs"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input
            className="h-8 w-36 text-xs"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={loadPicks}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      <div className="space-y-1.5">
        {picks.map((p) => (
          <div key={p.id} className="bg-card/50 rounded text-xs">
            <div
              className="flex cursor-pointer items-center justify-between px-3 py-2"
              onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
            >
              <div className="space-y-0.5">
                <div className="font-medium">
                  {p.favorite} {formatAmerican(p.fav_odds)} — {p.home} vs {p.away}
                </div>
                <div className="text-muted-foreground">
                  {p.league} · {p.picked_on}
                  {p.pnl !== null && (
                    <span
                      className={`ml-2 font-medium ${p.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={p.tier === 'green' ? 'default' : 'outline'}
                  className={`text-[10px] ${p.tier === 'green' ? 'bg-green-600 text-white' : ''}`}
                >
                  {p.tier}
                </Badge>
                {statusBadge(p)}
              </div>
            </div>

            {expandedId === p.id && p.ai_debrief && (
              <div className="border-border/30 bg-card/30 mx-3 mb-2 space-y-1.5 rounded border p-3">
                <p className="font-medium">{p.ai_debrief.summary}</p>
                {p.ai_debrief.factors.length > 0 && (
                  <ul className="text-muted-foreground space-y-0.5">
                    {p.ai_debrief.factors.map((f, i) => (
                      <li key={i}>• {f}</li>
                    ))}
                  </ul>
                )}
                {p.ai_debrief.lesson && (
                  <p className="text-yellow-300">
                    <span className="font-medium">Lesson:</span> {p.ai_debrief.lesson}
                  </p>
                )}
                <div className="text-muted-foreground">
                  Quality rating:{' '}
                  <span className="text-foreground font-medium">
                    {p.ai_debrief.quality_rating}/10
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}

        {!picks.length && !loading && (
          <p className="text-muted-foreground py-6 text-center text-xs">
            No picks logged for this range.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Tab 3: Results & Debrief ──────────────────────────────────────────────────

function ResultsDebriefTab() {
  const [picks, setPicks] = useState<(SportsPick & { ai_debrief?: DebriefResult })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const to = new Date().toLocaleDateString('en-CA')
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA')
    fetch(`/api/sports/picks?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d: { picks: (SportsPick & { ai_debrief?: DebriefResult })[] }) => setPicks(d.picks))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  const settled = picks.filter((p) => p.fav_won !== null)

  // By-league summary
  const byLeague: Record<string, { wins: number; losses: number }> = {}
  for (const p of settled) {
    if (!byLeague[p.league]) byLeague[p.league] = { wins: 0, losses: 0 }
    if (p.fav_won) byLeague[p.league].wins++
    else byLeague[p.league].losses++
  }

  if (loading) return <p className="text-muted-foreground p-4 text-sm">Loading results...</p>

  return (
    <div className="space-y-4">
      {/* By-league mini-table */}
      {Object.keys(byLeague).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Last 30 Days by League</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-xs">
              {Object.entries(byLeague).map(([league, stats]) => {
                const total = stats.wins + stats.losses
                const wr = total ? ((stats.wins / total) * 100).toFixed(1) : '--'
                return (
                  <div key={league} className="flex items-center justify-between">
                    <span className="font-medium">{league}</span>
                    <span className="text-muted-foreground">
                      {stats.wins}W/{stats.losses}L — {wr}%
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settled picks with debrief */}
      <div className="space-y-2">
        {settled.map((p) => (
          <Card key={p.id}>
            <CardContent className="space-y-2 pt-3 pb-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {p.favorite} {formatAmerican(p.fav_odds)} — {p.home} vs {p.away}
                </div>
                <div className="flex items-center gap-1.5">
                  {p.fav_won ? (
                    <Badge className="bg-green-600 text-[10px] text-white">Won</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">
                      Lost
                    </Badge>
                  )}
                  {p.pnl !== null && (
                    <span
                      className={`font-medium ${p.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-muted-foreground">
                {p.league} · {p.picked_on}
              </div>

              {p.ai_debrief ? (
                <div className="border-border/30 bg-card/30 space-y-1.5 rounded border p-2.5">
                  <p>{p.ai_debrief.summary}</p>
                  {p.ai_debrief.factors.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.ai_debrief.factors.map((f, i) => (
                        <span key={i} className="bg-muted rounded px-1.5 py-0.5 text-[10px]">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.ai_debrief.lesson && (
                    <p className="text-[11px] text-yellow-300">
                      <span className="font-medium">Lesson:</span> {p.ai_debrief.lesson}
                    </p>
                  )}
                  <div className="text-muted-foreground text-[10px]">
                    Pick quality:{' '}
                    {Array.from({ length: p.ai_debrief.quality_rating }, (_, i) => (
                      <span key={i}>★</span>
                    ))}
                    {Array.from({ length: 10 - p.ai_debrief.quality_rating }, (_, i) => (
                      <span key={i} className="opacity-30">
                        ★
                      </span>
                    ))}{' '}
                    {p.ai_debrief.quality_rating}/10
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-[11px]">
                  No debrief yet — runs automatically after settlement
                </p>
              )}
            </CardContent>
          </Card>
        ))}
        {!settled.length && (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No settled picks in the last 30 days.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Tab 4: Gate Status ────────────────────────────────────────────────────────

function GateStatusTab() {
  const [gateData, setGateData] = useState<GateResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/sports/gate')
      .then((r) => r.json())
      .then((d: GateResponse) => setGateData(d))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-muted-foreground p-4 text-sm">Loading gate status...</p>

  const gates = gateData?.gates ?? {}

  function GateCard({ domain, entry }: { domain: string; entry: GateEntry }) {
    const p = entry.progress
    const isOpen = entry.gate_status === 'open'

    const metrics = [
      {
        label: 'Sample size',
        current: p.sample_size,
        target: p.sample_size_target,
        display: `${p.sample_size}/${p.sample_size_target} bets`,
        met: p.sample_size >= p.sample_size_target,
      },
      {
        label: 'Win rate',
        current: (p.win_rate ?? 0) * 100,
        target: p.win_rate_target * 100,
        display:
          p.win_rate !== null
            ? `${(p.win_rate * 100).toFixed(1)}% (need ≥${(p.win_rate_target * 100).toFixed(0)}%)`
            : `-- (need ≥${(p.win_rate_target * 100).toFixed(0)}%)`,
        met: p.win_rate !== null && p.win_rate >= p.win_rate_target,
      },
      {
        label: 'ROI',
        current: (p.roi ?? 0) * 100,
        target: p.roi_target * 100,
        display:
          p.roi !== null
            ? `${(p.roi * 100).toFixed(1)}% (need ≥${(p.roi_target * 100).toFixed(0)}%)`
            : `-- (need ≥${(p.roi_target * 100).toFixed(0)}%)`,
        met: p.roi !== null && p.roi >= p.roi_target,
      },
      {
        label: 'Max drawdown',
        current: Math.abs(p.drawdown ?? 0) * 100,
        target: p.drawdown_target * 100,
        display:
          p.drawdown !== null
            ? `${(Math.abs(p.drawdown) * 100).toFixed(1)}% (need ≤${(p.drawdown_target * 100).toFixed(0)}%)`
            : `-- (need ≤${(p.drawdown_target * 100).toFixed(0)}%)`,
        met: p.drawdown !== null && Math.abs(p.drawdown) <= p.drawdown_target,
      },
    ]

    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm capitalize">{domain} Gate</CardTitle>
            <div className="flex items-center gap-2">
              <Badge
                variant={entry.current_mode === 'live' ? 'default' : 'outline'}
                className={
                  entry.current_mode === 'live' ? 'bg-green-600 text-white' : 'text-gray-400'
                }
              >
                {entry.current_mode.toUpperCase()}
              </Badge>
              <Badge
                variant={isOpen ? 'default' : 'outline'}
                className={isOpen ? 'bg-green-600 text-white' : ''}
              >
                {isOpen ? 'GATE OPEN' : 'GATE CLOSED'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {metrics.map((m) => (
            <div key={m.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{m.label}</span>
                <span className={m.met ? 'text-green-400' : 'text-yellow-400'}>
                  {m.display} {m.met ? '✓' : ''}
                </span>
              </div>
              <ProgressBar
                value={m.label === 'Max drawdown' ? Math.abs(p.drawdown ?? 0) * 100 : m.current}
                max={m.target}
                met={m.met}
              />
            </div>
          ))}

          {entry.last_recomputed_at && (
            <p className="text-muted-foreground text-[10px]">
              Last computed: {new Date(entry.last_recomputed_at).toLocaleDateString('en-CA')}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  if (!Object.keys(gates).length) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Gate data unavailable. Run migrations to seed trust_state.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {(['sports', 'trading'] as const).map((domain) =>
        gates[domain] ? <GateCard key={domain} domain={domain} entry={gates[domain]} /> : null
      )}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function SportsIntelPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">Sports Intel</h1>
        <p className="text-muted-foreground text-xs">Odds · Elo · Picks · Gate</p>
      </div>

      <Tabs defaultValue="games">
        <TabsList className="w-full">
          <TabsTrigger value="games" className="flex-1 text-xs">
            Today&apos;s Games
          </TabsTrigger>
          <TabsTrigger value="picks" className="flex-1 text-xs">
            Picks Log
          </TabsTrigger>
          <TabsTrigger value="results" className="flex-1 text-xs">
            Results
          </TabsTrigger>
          <TabsTrigger value="gate" className="flex-1 text-xs">
            Gate Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="games" className="mt-4">
          <TodaysGamesTab />
        </TabsContent>
        <TabsContent value="picks" className="mt-4">
          <PicksLogTab />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          <ResultsDebriefTab />
        </TabsContent>
        <TabsContent value="gate" className="mt-4">
          <GateStatusTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
