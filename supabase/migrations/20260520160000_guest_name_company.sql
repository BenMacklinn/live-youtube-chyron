alter table public.live_sessions
  add column if not exists guest_name text not null default '',
  add column if not exists guest_company text not null default '';
