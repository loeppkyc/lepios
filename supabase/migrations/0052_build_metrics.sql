-- Migration 0052: build_metrics — per-task estimate-vs-actual telemetry
-- Companion to F18 (measurement) and F19 (continuous improvement).
--
-- Justification (audit 2026-04-29):
--   task_queue.estimated_minutes/actual_minutes (added 0027) covers tasks routed
--   through pickup-runner only. Manual chat-driven build work, ports, audits,
--   and fixes never land in task_queue. build_metrics is the reflective
--   process-telemetry layer for ALL build work, regardless of source.
--   active_minutes, parallel_windows, clear_resets, reviewer_rejections,
--   first_try_pass, task_type enum, week/day_label have no existing home.
--
-- Access model (matches 0050/0051 pattern):
--   service_role  -> full access (BYPASSRLS, no policy needed)
--   authenticated -> DENY (no user_id column to scope by)
--   anon          -> DENY (no public-facing reads; SELECT returns [])
--
-- Writers: app/api/metrics/start, app/api/metrics/finish, scripts/track.ts
-- Readers: build_metrics_summary view (rollup by task_type + week)

create table if not exists public.build_metrics (
  task_id              text primary key,
  week                 int not null,
  day_label            text not null,
  description          text,
  estimate_claude_days numeric,
  estimate_source      text check (estimate_source in ('claude_chat', 'self', 'revised')),
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  active_minutes       int,
  parallel_windows     int default 1,
  clear_resets         int default 0,
  reviewer_rejections  int default 0,
  first_try_pass       boolean,
  task_type            text check (task_type in ('port', 'new_build', 'migration', 'fix')),
  notes                text
);

create index if not exists idx_build_metrics_week_day
  on public.build_metrics (week, day_label);

alter table public.build_metrics enable row level security;

comment on table public.build_metrics is
  'F18/F19 build telemetry -- per-task estimate vs actual, parallel-window count, '
  'reviewer rejections, first-try-pass. RLS enabled 2026-04-29 (migration 0052). '
  'No policies -- service_role only.';

-- Rollup view: one row per (task_type, week) for completed tasks only.
-- wall_clock_per_claude_day_estimate    = total wall-clock minutes / total estimated claude-days
-- active_minutes_per_claude_day_estimate = total active minutes    / total estimated claude-days
--
-- security_invoker = true: view runs with the caller's privileges, so RLS on
-- build_metrics is enforced when anon/authenticated select from the view.
-- Without this, Postgres runs the view as the owner (postgres) and bypasses RLS.
create or replace view public.build_metrics_summary
with (security_invoker = true) as
select
  task_type,
  week,
  count(*) as task_count,
  sum(extract(epoch from (completed_at - started_at)) / 60)::int as wall_clock_minutes,
  sum(active_minutes) as active_minutes_total,
  sum(estimate_claude_days) as estimate_claude_days_total,
  case when coalesce(sum(estimate_claude_days), 0) > 0
    then round((sum(extract(epoch from (completed_at - started_at)) / 60)
                / sum(estimate_claude_days))::numeric, 2)
    else null end as wall_clock_per_claude_day_estimate,
  case when coalesce(sum(estimate_claude_days), 0) > 0
    then round((sum(active_minutes)::numeric / sum(estimate_claude_days))::numeric, 2)
    else null end as active_minutes_per_claude_day_estimate,
  sum(case when first_try_pass = true then 1 else 0 end) as first_try_pass_count,
  sum(reviewer_rejections) as reviewer_rejections_total,
  sum(clear_resets) as clear_resets_total,
  round(avg(parallel_windows)::numeric, 2) as avg_parallel_windows
from public.build_metrics
where completed_at is not null
group by task_type, week
order by week, task_type;

comment on view public.build_metrics_summary is
  'F18 rollup: build_metrics aggregated by (task_type, week). Completed tasks only. '
  'Inherits RLS from build_metrics -- anon/authenticated SELECT returns [].';
