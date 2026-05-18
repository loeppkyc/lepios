'use client'

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import type { ExternalBenchmark } from '@/app/api/benchmarks/route'

interface BenchmarkTableProps {
  initialBenchmarks: ExternalBenchmark[]
}

function scoreClass(parity_score: number): string {
  if (parity_score >= 80) return 'text-positive font-semibold'
  if (parity_score >= 60) return 'text-warning font-semibold'
  return 'text-critical font-semibold'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function BenchmarkTable({ initialBenchmarks }: BenchmarkTableProps) {
  if (initialBenchmarks.length === 0) {
    return <p className="text-muted-foreground text-sm">No benchmarks recorded yet.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>System</TableHead>
          <TableHead>Benchmark</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Measured</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {initialBenchmarks.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="font-medium">{b.vs_system}</TableCell>
            <TableCell>{b.benchmark_name}</TableCell>
            <TableCell>
              <span className={scoreClass(b.parity_score)}>{b.parity_score}%</span>
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {formatDate(b.measured_at)}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">{b.notes ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
