alter table public.live_sessions
  add column if not exists generation_mode text not null default 'timeline'
  check (generation_mode in ('guest', 'timeline'));
