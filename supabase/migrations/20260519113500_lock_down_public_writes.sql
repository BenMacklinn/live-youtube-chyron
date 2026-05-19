alter table public.live_sessions drop column if exists process_token;

drop policy if exists "public insert live sessions" on public.live_sessions;
drop policy if exists "public update live sessions actions" on public.live_sessions;
drop policy if exists "public insert chyron memory" on public.chyron_memory;
