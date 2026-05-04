-- Private bucket for nightly data exports (knowledge + chat history).
-- Service role can read/write; all other roles denied.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'backups',
  'backups',
  false,
  104857600, -- 100 MB ceiling; knowledge NDJSON ~15 MB at 10k rows
  ARRAY['application/x-ndjson', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;
