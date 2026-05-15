import { describe, it, expect } from 'vitest'

// Unit tests for the knowledge_dedupe win-rule logic.
// These verify the SELECT DISTINCT ON ordering is deterministic
// and that the null-entity exclusion is correct — without hitting the DB.

interface KnowledgeRow {
  id: string
  entity: string | null
  times_used: number
  updated_at: string
}

// Mirrors the win-rule from 0206_knowledge_dedupe.sql:
//   DISTINCT ON (entity) ORDER BY entity, times_used DESC, updated_at DESC, id DESC
function pickWinners(rows: KnowledgeRow[]): Set<string> {
  const byEntity = new Map<string, KnowledgeRow[]>()
  for (const row of rows) {
    if (row.entity === null) continue // null rows are never touched
    const group = byEntity.get(row.entity) ?? []
    group.push(row)
    byEntity.set(row.entity, group)
  }

  const winnerIds = new Set<string>()
  for (const [, group] of byEntity) {
    const winner = group.sort((a, b) => {
      if (b.times_used !== a.times_used) return b.times_used - a.times_used
      if (b.updated_at !== a.updated_at) return b.updated_at.localeCompare(a.updated_at)
      return b.id.localeCompare(a.id) // UUID lex, largest wins
    })[0]
    winnerIds.add(winner.id)
  }
  return winnerIds
}

describe('knowledge_dedupe win-rule', () => {
  it('picks highest times_used as winner', () => {
    const rows: KnowledgeRow[] = [
      { id: 'aaa', entity: 'colin', times_used: 5, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'bbb', entity: 'colin', times_used: 10, updated_at: '2025-01-01T00:00:00Z' },
      { id: 'ccc', entity: 'colin', times_used: 2, updated_at: '2026-06-01T00:00:00Z' },
    ]
    const winners = pickWinners(rows)
    expect(winners.has('bbb')).toBe(true) // highest times_used = 10
    expect(winners.size).toBe(1)
  })

  it('breaks tie by most recent updated_at', () => {
    const rows: KnowledgeRow[] = [
      { id: 'aaa', entity: 'megan', times_used: 5, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'bbb', entity: 'megan', times_used: 5, updated_at: '2026-06-01T00:00:00Z' },
    ]
    const winners = pickWinners(rows)
    expect(winners.has('bbb')).toBe(true) // more recent updated_at
    expect(winners.size).toBe(1)
  })

  it('breaks final tie by largest UUID (lex)', () => {
    const rows: KnowledgeRow[] = [
      { id: 'zzz-001', entity: 'cora', times_used: 3, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'aaa-001', entity: 'cora', times_used: 3, updated_at: '2026-01-01T00:00:00Z' },
    ]
    const winners = pickWinners(rows)
    expect(winners.has('zzz-001')).toBe(true) // largest UUID lex
    expect(winners.size).toBe(1)
  })

  it('never touches null-entity rows', () => {
    const rows: KnowledgeRow[] = [
      { id: 'null-1', entity: null, times_used: 0, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'null-2', entity: null, times_used: 0, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'real-1', entity: 'parents', times_used: 1, updated_at: '2026-01-01T00:00:00Z' },
    ]
    const winners = pickWinners(rows)
    expect(winners.has('null-1')).toBe(false)
    expect(winners.has('null-2')).toBe(false)
    expect(winners.has('real-1')).toBe(true)
    expect(winners.size).toBe(1)
  })

  it('handles multiple distinct entities correctly', () => {
    const rows: KnowledgeRow[] = [
      { id: 'c-1', entity: 'colin', times_used: 10, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'c-2', entity: 'colin', times_used: 2, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'm-1', entity: 'megan', times_used: 7, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'm-2', entity: 'megan', times_used: 7, updated_at: '2026-06-01T00:00:00Z' },
    ]
    const winners = pickWinners(rows)
    expect(winners.has('c-1')).toBe(true) // colin: highest times_used
    expect(winners.has('m-2')).toBe(true) // megan: tied times_used, newest updated_at
    expect(winners.size).toBe(2)
  })

  it('produces zero duplicates after dedup', () => {
    const rows: KnowledgeRow[] = [
      { id: 'a', entity: 'foo', times_used: 1, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'b', entity: 'foo', times_used: 2, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'c', entity: 'bar', times_used: 5, updated_at: '2026-01-01T00:00:00Z' },
      { id: 'd', entity: null, times_used: 0, updated_at: '2026-01-01T00:00:00Z' },
    ]
    const winners = pickWinners(rows)
    const entityCount = new Map<string, number>()
    for (const row of rows.filter((r) => r.entity !== null && winners.has(r.id))) {
      entityCount.set(row.entity!, (entityCount.get(row.entity!) ?? 0) + 1)
    }
    for (const [, count] of entityCount) {
      expect(count).toBe(1)
    }
  })
})
