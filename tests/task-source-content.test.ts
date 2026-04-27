import { describe, it, expect } from 'vitest'
import { extractSourceFromMetadata, describeSourceMeta } from '../lib/harness/source-content'

// ── extractSourceFromMetadata ───────────────────────────────────────────────

describe('extractSourceFromMetadata', () => {
  it('returns null for null metadata', () => {
    expect(extractSourceFromMetadata(null)).toBeNull()
  })

  it('returns null for undefined metadata', () => {
    expect(extractSourceFromMetadata(undefined)).toBeNull()
  })

  it('returns null for empty object (source_content absent)', () => {
    expect(extractSourceFromMetadata({})).toBeNull()
  })

  it('returns null for empty string source_content', () => {
    expect(extractSourceFromMetadata({ source_content: '' })).toBeNull()
  })

  it('returns content string when present and non-empty', () => {
    const meta = { source_content: '"""\nMy Profile\n"""\nimport streamlit as st\n' }
    expect(extractSourceFromMetadata(meta)).toBe(meta.source_content)
  })

  it('ignores non-string source_content values', () => {
    expect(extractSourceFromMetadata({ source_content: 42 })).toBeNull()
    expect(extractSourceFromMetadata({ source_content: null })).toBeNull()
    expect(extractSourceFromMetadata({ source_content: [] })).toBeNull()
  })
})

// ── Cloud coordinator Phase 1a: shape validation ────────────────────────────

describe('patched task metadata shape', () => {
  it('profile (a88b0018) — expected shape after patch', () => {
    // Mirrors what scripts/patch-task-source-content.ts writes for 9_Profile.py
    const patchedMeta: Record<string, unknown> = {
      bump: 'harness:streamlit_rebuild_profile=100',
      lines: 114,
      module: '9_Profile.py',
      category: 'life',
      complexity: 'small',
      source_content:
        '"""\nMy Profile — view account info and change password.\n"""\nimport streamlit as st\n',
      source_files: ['pages/9_Profile.py'],
      source_captured_at: '2026-04-28T00:00:00.000Z',
      source_line_count: 114,
    }

    const source = extractSourceFromMetadata(patchedMeta)
    expect(source).not.toBeNull()
    expect(source).toContain('My Profile')

    const desc = describeSourceMeta(patchedMeta)
    expect(desc.present).toBe(true)
    expect(desc.files).toEqual(['pages/9_Profile.py'])
    expect(desc.line_count).toBe(114)
    expect(desc.captured_at).not.toBeNull()
  })

  it('n8n_webhook (ec1d00c7) — expected shape after patch', () => {
    const patchedMeta: Record<string, unknown> = {
      bump: 'harness:streamlit_rebuild_n8n_webhook=100',
      lines: 114,
      module: '99_n8n_Webhook.py',
      category: 'automation',
      complexity: 'small',
      source_content: '"""\nn8n Webhook Receiver — hidden page.\n"""\nimport streamlit as st\n',
      source_files: ['pages/99_n8n_Webhook.py'],
      source_captured_at: '2026-04-28T00:00:00.000Z',
      source_line_count: 114,
    }

    expect(extractSourceFromMetadata(patchedMeta)).toContain('n8n')
    expect(describeSourceMeta(patchedMeta).present).toBe(true)
  })

  it('dropbox_archiver (8ab362ac) — expected shape after patch', () => {
    const patchedMeta: Record<string, unknown> = {
      bump: 'harness:streamlit_rebuild_dropbox_archiver=100',
      lines: 141,
      module: '97_Dropbox_Archiver.py',
      category: 'automation',
      complexity: 'small',
      source_content:
        '"""\nDropbox Archiver — Offload old files to free up Dropbox storage.\n"""\n',
      source_files: ['pages/97_Dropbox_Archiver.py'],
      source_captured_at: '2026-04-28T00:00:00.000Z',
      source_line_count: 141,
    }

    expect(extractSourceFromMetadata(patchedMeta)).toContain('Dropbox')
    expect(describeSourceMeta(patchedMeta).present).toBe(true)
  })

  it('tax_centre (af44ba61) — corrected scope: 7995 lines, 3 files, large complexity', () => {
    // Scanner reported 147 lines (entry-point only). Actual scope: 3 files, 7995 lines.
    // Priority bumped to 4 (manual rebuild — too complex for autonomous coordinator).
    const patchedMeta: Record<string, unknown> = {
      bump: 'harness:streamlit_rebuild_tax_centre=100',
      lines: 7995,
      module: '6_Tax_Centre.py',
      category: 'finance',
      complexity: 'large',
      grounding_required: true,
      source_content: [
        '# ============================================================',
        '# FILE: pages/6_Tax_Centre.py (147 lines)',
        '# ============================================================',
        '"""\nTax Centre -- Consolidated tax hub.\nRouter only — section renderers live in pages/tax_centre/.\n"""\n',
        '# ============================================================',
        '# FILE: pages/tax_centre/colin_tax.py (6922 lines)',
        '# ============================================================',
        '"""\nTax Centre — Colin sections.\n"""\n',
        '# ============================================================',
        '# FILE: pages/tax_centre/megan_tax.py (1073 lines)',
        '# ============================================================',
        '"""\nMegan tax sections.\n"""\n',
      ].join('\n'),
      source_files: [
        'pages/6_Tax_Centre.py',
        'pages/tax_centre/colin_tax.py',
        'pages/tax_centre/megan_tax.py',
      ],
      source_captured_at: '2026-04-28T00:00:00.000Z',
      source_line_count: 7995,
    }

    // Corrected scope fields
    expect(patchedMeta.lines).toBe(7995)
    expect(patchedMeta.complexity).toBe('large')

    // All 3 files present in source_content
    const source = extractSourceFromMetadata(patchedMeta)
    expect(source).not.toBeNull()
    expect(source).toContain('pages/6_Tax_Centre.py')
    expect(source).toContain('pages/tax_centre/colin_tax.py')
    expect(source).toContain('pages/tax_centre/megan_tax.py')

    // describeSourceMeta correctly surfaces 3 files
    const desc = describeSourceMeta(patchedMeta)
    expect(desc.files).toHaveLength(3)
    expect(desc.line_count).toBe(7995)
  })
})

// ── Phase 1a failure mode: absent source_content triggers escalation ────────

describe('cloud coordinator Phase 1a escalation', () => {
  it('legacy task (no source_content) returns null — coordinator must escalate', () => {
    const legacyMeta = {
      bump: 'harness:streamlit_rebuild_profile=100',
      lines: 114,
      module: '9_Profile.py',
      category: 'life',
      complexity: 'small',
    }
    expect(extractSourceFromMetadata(legacyMeta)).toBeNull()

    const desc = describeSourceMeta(legacyMeta)
    expect(desc.present).toBe(false)
    expect(desc.files).toHaveLength(0)
  })

  it('describeSourceMeta reports absent correctly for null input', () => {
    const desc = describeSourceMeta(null)
    expect(desc.present).toBe(false)
    expect(desc.files).toHaveLength(0)
    expect(desc.line_count).toBe(0)
    expect(desc.captured_at).toBeNull()
  })
})
