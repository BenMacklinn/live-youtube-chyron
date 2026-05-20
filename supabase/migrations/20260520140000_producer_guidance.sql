alter table public.live_sessions
  add column if not exists producer_guidance text not null default '';
