alter table public.chyron_batches
  add column if not exists recent_summary text not null default '';
