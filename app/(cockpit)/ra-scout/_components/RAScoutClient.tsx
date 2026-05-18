'use client'

import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface ScanResult {
  set_number: string
  name: string | null
  asin: string | null
  amazon_price_cad: number | null
  fba_fee_est_cad: number | null
  buy_price_cad: number | null
  net_margin_pct: number | null
  verdict: 'BUY' | 'WATCH' | 'SKIP'
}

interface RecentScan {
  id: string
  scanned_at: string
  location_note: string | null
  detected_set_numbers: string[]
  profitable_count: number
}

interface Props {
  recentScans: RecentScan[]
}

function verdictBadge(verdict: ScanResult['verdict']) {
  if (verdict === 'BUY') {
    return (
      <Badge className="border-transparent bg-green-600 text-xs font-bold text-white">BUY</Badge>
    )
  }
  if (verdict === 'WATCH') {
    return (
      <Badge className="border-transparent bg-yellow-500 text-xs font-bold text-black">WATCH</Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-xs">
      SKIP
    </Badge>
  )
}

export default function RAScoutClient({ recentScans }: Props) {
  const [locationNote, setLocationNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [detected, setDetected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setError(null)
    setResults(null)

    try {
      // Convert file to base64
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binary)

      const response = await fetch('/api/ra-scout/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64,
          media_type: file.type || 'image/jpeg',
          location_note: locationNote || undefined,
        }),
      })

      if (!response.ok) {
        const err = (await response.json()) as { error?: string }
        throw new Error(err.error ?? `Request failed: ${response.status}`)
      }

      const data = (await response.json()) as {
        scan_id: string | null
        detected: string[]
        results: ScanResult[]
      }

      setDetected(data.detected)
      setResults(data.results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed. Try again.')
    } finally {
      setLoading(false)
      // Reset file input so same file can be resubmitted
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const buyCount = results?.filter((r) => r.verdict === 'BUY').length ?? 0
  const watchCount = results?.filter((r) => r.verdict === 'WATCH').length ?? 0

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">RA Scout</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Point your camera at a shelf. AI reads the set numbers and tells you what to grab.
        </p>
      </div>

      {/* Scan section */}
      <Card>
        <CardHeader className="pb-3">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            New Scan
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Location note (optional)
            </label>
            <Input
              placeholder="e.g. Walmart Clearance, Costco seasonal"
              value={locationNote}
              onChange={(e) => setLocationNote(e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
              disabled={loading}
            />
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="h-16 w-full text-base"
            >
              {loading ? 'Scanning…' : 'Take Photo / Upload Image'}
            </Button>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>

      {/* Results */}
      {results !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              Results — {detected.length} set{detected.length !== 1 ? 's' : ''} detected
            </h2>
            {results.length > 0 && (
              <div className="flex gap-2 text-xs">
                {buyCount > 0 && (
                  <span className="font-semibold text-green-600">{buyCount} BUY</span>
                )}
                {watchCount > 0 && (
                  <span className="font-semibold text-yellow-600">{watchCount} WATCH</span>
                )}
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-8 text-center text-sm">
                No set numbers found — try a clearer photo.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {results.map((r) => (
                <Card
                  key={r.set_number}
                  className={
                    r.verdict === 'BUY'
                      ? 'border-green-600/40'
                      : r.verdict === 'WATCH'
                        ? 'border-yellow-500/40'
                        : ''
                  }
                >
                  <CardContent className="space-y-2 pt-4 pb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-sm font-bold">#{r.set_number}</span>
                        {r.name && (
                          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                            {r.name}
                          </p>
                        )}
                      </div>
                      {verdictBadge(r.verdict)}
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {r.amazon_price_cad !== null && (
                        <>
                          <span className="text-muted-foreground">Amazon CA</span>
                          <span className="font-medium">${r.amazon_price_cad.toFixed(2)}</span>
                        </>
                      )}
                      {r.fba_fee_est_cad !== null && (
                        <>
                          <span className="text-muted-foreground">FBA est.</span>
                          <span className="font-medium">${r.fba_fee_est_cad.toFixed(2)}</span>
                        </>
                      )}
                      {r.net_margin_pct !== null && (
                        <>
                          <span className="text-muted-foreground">Margin</span>
                          <span
                            className={
                              r.net_margin_pct >= 30
                                ? 'font-bold text-green-600'
                                : r.net_margin_pct >= 15
                                  ? 'font-bold text-yellow-600'
                                  : 'text-muted-foreground'
                            }
                          >
                            {r.net_margin_pct.toFixed(1)}%
                          </span>
                        </>
                      )}
                    </div>

                    {r.amazon_price_cad === null && (
                      <p className="text-muted-foreground text-xs">Price not found</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent scans */}
      {recentScans.length > 0 && (
        <div>
          <button
            className="text-muted-foreground flex items-center gap-1 text-xs font-semibold tracking-wide uppercase"
            onClick={() => setHistoryOpen((o) => !o)}
          >
            <span>{historyOpen ? '▾' : '▸'}</span>
            Recent Scans ({recentScans.length})
          </button>

          {historyOpen && (
            <div className="mt-2 space-y-2">
              {recentScans.map((scan) => {
                const date = new Date(scan.scanned_at)
                const label = date.toLocaleDateString('en-CA', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
                return (
                  <Card key={scan.id}>
                    <CardContent className="flex items-center justify-between gap-4 py-3">
                      <div>
                        <span className="text-xs font-medium">{label}</span>
                        {scan.location_note && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {scan.location_note}
                          </span>
                        )}
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {scan.detected_set_numbers.length} set
                          {scan.detected_set_numbers.length !== 1 ? 's' : ''} scanned
                        </p>
                      </div>
                      {scan.profitable_count > 0 ? (
                        <Badge className="border-transparent bg-green-600 text-xs text-white">
                          {scan.profitable_count} BUY
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-xs">
                          0 BUY
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
