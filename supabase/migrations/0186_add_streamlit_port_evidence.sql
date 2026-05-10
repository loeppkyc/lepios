-- Migration 0186: add port_evidence column to streamlit_modules
-- Stores evidence for second-sweep classification (COMPOUND_PORTED / SUPERSEDED / OBSOLETE).
ALTER TABLE streamlit_modules ADD COLUMN IF NOT EXISTS port_evidence TEXT;
