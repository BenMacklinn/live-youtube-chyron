create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create index if not exists chyron_options_session_idx
  on public.chyron_options(session_id);
