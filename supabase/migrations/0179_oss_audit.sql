-- Migration 0179: OSS audit — Step 1 schema
--
-- Adds oss_audit_status/at/evidence to streamlit_modules (rule-based v1),
-- creates oss_packages cache table for future oss_scout API scoring (Step 4),
-- and seeds capability_registry rows for the three oss-radar outbound clients.

-- A. Additive columns on streamlit_modules
ALTER TABLE streamlit_modules
  ADD COLUMN oss_audit_status TEXT NOT NULL DEFAULT 'unaudited'
    CONSTRAINT oss_audit_status_values CHECK (
      oss_audit_status IN ('unaudited','replace','fork-extend','absorb-patterns','keep','complement-with')
    ),
  ADD COLUMN oss_audit_at TIMESTAMPTZ,
  ADD COLUMN oss_audit_evidence JSONB;

-- B. oss_packages — cache table for future API-based scoring (oss_scout Step 4)
CREATE TABLE oss_packages (
  id               UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT       NOT NULL,
  ecosystem        TEXT       NOT NULL CHECK (ecosystem IN ('python','node','github')),
  gh_stars         INT,
  last_activity_at DATE,
  license          TEXT,
  lepios_alternative TEXT,
  fit_score        INT        CHECK (fit_score BETWEEN 0 AND 100),
  fit_rationale    TEXT,
  audit_status     TEXT       NOT NULL DEFAULT 'pending'
                              CHECK (audit_status IN ('pending','scored','reviewed')),
  last_audited_at  TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name, ecosystem)
);

-- C. capability_registry seeds for oss-radar outbound clients
-- ON CONFLICT DO NOTHING: 0170 may have inserted npm/pypi already; github is new.
INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES
  ('net.outbound.github', 'net', 'GitHub REST API — repo search + metadata',       'enforce', false),
  ('net.outbound.npm',    'net', 'npm registry — package metadata + downloads',     'enforce', false),
  ('net.outbound.pypi',   'net', 'PyPI JSON API — package metadata lookup',         'enforce', false)
ON CONFLICT (capability) DO NOTHING;
