alter table public.live_sessions
  add column if not exists context_cleared_at timestamptz;
