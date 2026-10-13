-- Saved checks are kept for 3 months, then deleted. Rankings keep their position and checked_at;
-- only the link to the raw result list is cleared (snapshot_id is ON DELETE SET NULL).
create or replace function public.prune_serp_snapshots()
returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from public.serp_snapshots where fetched_at < now() - interval '3 months' returning 1
  )
  select count(*)::integer from gone;
$$;

-- Maintenance only: not callable through the API.
revoke execute on function public.prune_serp_snapshots() from public, anon, authenticated;

create index serp_snapshots_fetched_at_idx on public.serp_snapshots (fetched_at);
-- Without it every deleted check scans rankings to clear snapshot_id.
create index rankings_snapshot_id_idx on public.rankings (snapshot_id);

create extension if not exists pg_cron;

-- Daily at 03:17 UTC; cron.schedule replaces a job with the same name.
select cron.schedule('prune-serp-snapshots', '17 3 * * *', 'select public.prune_serp_snapshots()');
