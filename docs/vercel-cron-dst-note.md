# Vercel Cron DST Note

Vercel cron runs on UTC. Our schedules use fixed UTC times,
which means the local Mountain Time they fire at shifts by
an hour twice a year with daylight savings.

- /api/cron/night-tick at 08:00 UTC
  → 02:00 MDT (summer) / 01:00 MST (winter)
- /api/cron/morning-digest at 12:00 UTC
  → 06:00 MDT (summer) / 05:00 MST (winter)

Acceptable drift. If we ever want exact local time year-round,
add a timezone-aware wrapper in the route handler.
