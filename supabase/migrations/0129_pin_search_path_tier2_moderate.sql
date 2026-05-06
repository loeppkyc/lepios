-- 0129_pin_search_path_tier2_moderate.sql
--
-- Tier 2 of the search_path audit (Supabase advisor 2026-05-06,
-- function_search_path_mutable WARN class). Closes 8 of the remaining 9
-- findings; Tier 3 (match_knowledge) follows in 0130.
--
-- These plpgsql functions reference user-schema tables (public.task_queue,
-- public.knowledge, public.gmail_messages) which MUST be schema-qualified
-- once search_path is empty. pg_catalog stays implicitly first in the search
-- path, so now() / array_append() resolve — but we qualify now() explicitly
-- for unambiguous lockdown (matches Tier 1 style, migration 0128).
--
-- Body changes vs. pre-existing definitions:
--
--   append_scan_labels_batch:
--     - UPDATE gmail_messages → UPDATE public.gmail_messages (was unqualified)
--     - array_append(...) → pg_catalog.array_append(...)
--
--   rebuild_knowledge_ivfflat_index:
--     - DROP INDEX IF EXISTS knowledge_embedding_idx
--         → DROP INDEX IF EXISTS public.knowledge_embedding_idx
--     - vector_cosine_ops → public.vector_cosine_ops (operator class lives in
--       the vector extension's schema, currently public; see deferred WARN
--       extension_in_public for future schema move)
--
--   The other 6 fns: SET clause only, no body change beyond NOW()/now() →
--   pg_catalog.now() qualification for consistency.
--
-- Idempotent via CREATE OR REPLACE. SECURITY DEFINER preserved where set.
-- No GRANT/REVOKE changes (those landed in 0126/0127).

-- 1. claim_next_task — task pickup runner; SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.claim_next_task(p_run_id text)
RETURNS SETOF public.task_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.task_queue
  SET
    status     = 'claimed',
    claimed_at = pg_catalog.now(),
    claimed_by = p_run_id
  WHERE id = (
    SELECT id
    FROM   public.task_queue
    WHERE  status = 'queued'
    ORDER  BY priority ASC, created_at ASC
    LIMIT  1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$function$;

-- 2. idea_inbox_mirror_to_knowledge — trigger fn (idea_inbox INSERT/UPDATE)
CREATE OR REPLACE FUNCTION public.idea_inbox_mirror_to_knowledge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.knowledge
    (entity, category, domain, title, problem, solution, context, confidence, tags)
  VALUES (
    'idea_inbox:' || NEW.id::text,
    'idea',
    'memory',
    NEW.title,
    NULL,
    NEW.summary,
    coalesce(NEW.body,'') || ' [status=' || NEW.status || ', source=' || NEW.source || ']',
    NEW.score::real,
    NEW.tags
  )
  ON CONFLICT (entity) WHERE entity LIKE 'idea_inbox:%'
  DO UPDATE SET
    title       = EXCLUDED.title,
    solution    = EXCLUDED.solution,
    context     = EXCLUDED.context,
    confidence  = EXCLUDED.confidence,
    tags        = EXCLUDED.tags,
    updated_at  = pg_catalog.now();
  RETURN NEW;
END;
$function$;

-- 3. decisions_log_mirror_to_knowledge — trigger fn (decisions_log INSERT/UPDATE)
CREATE OR REPLACE FUNCTION public.decisions_log_mirror_to_knowledge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_confidence REAL;
  v_context    TEXT;
BEGIN
  v_confidence := CASE WHEN NEW.superseded_at IS NULL THEN 0.85 ELSE 0.40 END;

  v_context := coalesce(NEW.reason, '') ||
               ' [category=' || NEW.category ||
               ', decided_by=' || NEW.decided_by ||
               ', source=' || NEW.source ||
               CASE WHEN NEW.superseded_at IS NOT NULL
                    THEN ', superseded_at=' || NEW.superseded_at::text
                    ELSE '' END ||
               ']';

  INSERT INTO public.knowledge
    (entity, category, domain, title, problem, solution, context, confidence, tags)
  VALUES (
    'decisions_log:' || NEW.id::text,
    'decision',
    'memory',
    NEW.topic,
    NEW.context,
    NEW.chosen_path,
    v_context,
    v_confidence,
    NEW.tags
  )
  ON CONFLICT (entity) WHERE entity LIKE 'decisions_log:%'
  DO UPDATE SET
    title       = EXCLUDED.title,
    problem     = EXCLUDED.problem,
    solution    = EXCLUDED.solution,
    context     = EXCLUDED.context,
    confidence  = EXCLUDED.confidence,
    tags        = EXCLUDED.tags,
    updated_at  = pg_catalog.now();

  RETURN NEW;
END;
$function$;

-- 4. append_scan_labels_batch — gmail label batch update
--    Body change: gmail_messages → public.gmail_messages (was unqualified
--    pre-this-migration — would fail with empty search_path).
CREATE OR REPLACE FUNCTION public.append_scan_labels_batch(p_message_ids text[], p_label text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.gmail_messages
  SET    scan_labels = pg_catalog.array_append(scan_labels, p_label)
  WHERE  message_id = ANY(p_message_ids)
    AND  NOT (scan_labels @> ARRAY[p_label]);
END;
$function$;

-- 5. rebuild_knowledge_ivfflat_index — pgvector ivfflat index rebuild;
--    SECURITY DEFINER. Body changes: index name + operator class qualified.
CREATE OR REPLACE FUNCTION public.rebuild_knowledge_ivfflat_index()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  DROP INDEX IF EXISTS public.knowledge_embedding_idx;
  CREATE INDEX knowledge_embedding_idx
    ON public.knowledge USING ivfflat (embedding public.vector_cosine_ops)
    WITH (lists = 50);
END;
$function$;

-- 6. reclaim_stale_tasks — task_queue heartbeat reclaim; SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.reclaim_stale_tasks()
RETURNS TABLE(action text, task_id uuid, new_retry_count smallint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  rec           RECORD;
  v_new_rc      SMALLINT;
  v_new_status  TEXT;
BEGIN
  FOR rec IN
    SELECT q.id, q.retry_count, q.max_retries
    FROM   public.task_queue q
    WHERE  q.status IN ('claimed', 'running')
      AND  COALESCE(q.last_heartbeat_at, q.claimed_at) < pg_catalog.now() - INTERVAL '15 minutes'
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_rc := (rec.retry_count + 1)::SMALLINT;

    IF v_new_rc >= rec.max_retries THEN
      v_new_status := 'cancelled';
      UPDATE public.task_queue
      SET
        retry_count   = v_new_rc,
        status        = 'cancelled',
        error_message = 'stale claim: max retries exhausted',
        completed_at  = pg_catalog.now()
      WHERE id = rec.id;
    ELSE
      v_new_status := 'queued';
      UPDATE public.task_queue
      SET
        retry_count       = v_new_rc,
        status            = 'queued',
        claimed_at        = NULL,
        claimed_by        = NULL,
        last_heartbeat_at = NULL
      WHERE id = rec.id;
    END IF;

    action          := v_new_status;
    task_id         := rec.id;
    new_retry_count := v_new_rc;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- 7. knowledge_mark_used — confidence/usage bump on retrieval; SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.knowledge_mark_used(p_id uuid, p_helpful boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_helpful THEN
    UPDATE public.knowledge SET
      times_used    = times_used + 1,
      times_helpful = times_helpful + 1,
      last_used_at  = pg_catalog.now(),
      confidence    = LEAST(confidence + 0.05, 1.0),
      updated_at    = pg_catalog.now()
    WHERE id = p_id;
  ELSE
    UPDATE public.knowledge SET
      times_used   = times_used + 1,
      last_used_at = pg_catalog.now(),
      confidence   = GREATEST(confidence - 0.03, 0.1),
      updated_at   = pg_catalog.now()
    WHERE id = p_id;
  END IF;
END;
$function$;

-- 8. knowledge_decay_stale — age-out unused knowledge; SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.knowledge_decay_stale(p_cutoff timestamp with time zone)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.knowledge SET
    confidence = GREATEST(confidence - 0.05, 0.1),
    updated_at = pg_catalog.now()
  WHERE (last_used_at IS NULL OR last_used_at < p_cutoff)
    AND confidence > 0.1;
END;
$function$;
