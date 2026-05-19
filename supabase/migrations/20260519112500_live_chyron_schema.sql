create extension if not exists pgcrypto;

create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  youtube_url text not null,
  mode text not null default 'chyron' check (mode in ('chyron', 'verbatim')),
  status text not null default 'connecting' check (status in ('connecting', 'transcribing', 'error', 'ended')),
  start_sec integer not null default 0 check (start_sec >= 0),
  next_offset_sec numeric not null default 0,
  context_window_sec integer not null default 60,
  process_token text not null default encode(gen_random_bytes(24), 'hex'),
  active_chyron text not null default '',
  latest_verbatim text not null default '',
  latest_batch_id uuid,
  session_summary text not null default '',
  last_topic text not null default '',
  known_entities text[] not null default '{}',
  topic_history text[] not null default '{}',
  context_version integer not null default 0,
  last_generation_version integer not null default 0,
  last_generation_at timestamptz,
  last_transcript_text text not null default '',
  audio_bytes_sent bigint not null default 0,
  chyron_input_tokens integer not null default 0,
  chyron_output_tokens integer not null default 0,
  chyron_requests integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  text text not null,
  offset_sec numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chyron_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  session_summary text not null default '',
  topic text not null default '',
  entities text[] not null default '{}',
  verbatim_caption text not null default '',
  chyron_cadence_sec integer not null default 8,
  next_batch_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.chyron_options (
  id text primary key,
  batch_id uuid not null references public.chyron_batches(id) on delete cascade,
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  option_index integer not null default 0,
  text text not null,
  rationale text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.chyron_memory (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  chyron_id text,
  text text not null,
  action text not null check (action in ('approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists transcript_segments_session_created_idx
  on public.transcript_segments(session_id, created_at);

create index if not exists chyron_batches_session_created_idx
  on public.chyron_batches(session_id, created_at desc);

create index if not exists chyron_options_batch_idx
  on public.chyron_options(batch_id, option_index);

create index if not exists chyron_memory_session_created_idx
  on public.chyron_memory(session_id, created_at desc);

create index if not exists session_events_session_created_idx
  on public.session_events(session_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_live_sessions_updated_at on public.live_sessions;
create trigger set_live_sessions_updated_at
before update on public.live_sessions
for each row execute function public.set_updated_at();

alter table public.live_sessions enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.chyron_batches enable row level security;
alter table public.chyron_options enable row level security;
alter table public.chyron_memory enable row level security;
alter table public.session_events enable row level security;

drop policy if exists "public read live sessions" on public.live_sessions;
create policy "public read live sessions"
on public.live_sessions for select
to anon, authenticated
using (true);

drop policy if exists "public insert live sessions" on public.live_sessions;
create policy "public insert live sessions"
on public.live_sessions for insert
to anon, authenticated
with check (true);

drop policy if exists "public update live sessions actions" on public.live_sessions;
create policy "public update live sessions actions"
on public.live_sessions for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public read transcript segments" on public.transcript_segments;
create policy "public read transcript segments"
on public.transcript_segments for select
to anon, authenticated
using (true);

drop policy if exists "public read chyron batches" on public.chyron_batches;
create policy "public read chyron batches"
on public.chyron_batches for select
to anon, authenticated
using (true);

drop policy if exists "public read chyron options" on public.chyron_options;
create policy "public read chyron options"
on public.chyron_options for select
to anon, authenticated
using (true);

drop policy if exists "public read chyron memory" on public.chyron_memory;
create policy "public read chyron memory"
on public.chyron_memory for select
to anon, authenticated
using (true);

drop policy if exists "public insert chyron memory" on public.chyron_memory;
create policy "public insert chyron memory"
on public.chyron_memory for insert
to anon, authenticated
with check (true);

drop policy if exists "public read session events" on public.session_events;
create policy "public read session events"
on public.session_events for select
to anon, authenticated
using (true);

do $$
begin
  alter publication supabase_realtime add table public.live_sessions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.transcript_segments;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.chyron_batches;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.chyron_options;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.chyron_memory;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.session_events;
exception when duplicate_object then null;
end $$;
