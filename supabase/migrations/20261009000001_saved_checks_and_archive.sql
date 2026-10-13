-- Every complete DataForSEO check, kept so the same keyword + location is not paid for twice
-- within the reuse window (SNAPSHOT_MAX_AGE_MS in apps/api/src/pull-service.ts) and stays auditable.
create table public.serp_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- keywordKey() in packages/shared: trimmed, single-spaced, lower case.
  keyword_key text not null check (length(keyword_key) > 0),
  keyword text not null,
  location_code integer not null,
  fetched_at timestamptz not null default now(),
  cost numeric(12, 6),
  -- Organic results only: [{ rank, domain, url, title }].
  items jsonb not null check (jsonb_typeof(items) = 'array')
);

create index serp_snapshots_lookup_idx on public.serp_snapshots (keyword_key, location_code, fetched_at desc);

-- Written only by the API (service role); signed-in users may read.
alter table public.serp_snapshots enable row level security;
create policy serp_snapshots_authenticated_read on public.serp_snapshots for select to authenticated using (true);

-- When Google was checked for this position, and the check it came from.
alter table public.rankings
  add column checked_at timestamptz,
  add column snapshot_id uuid references public.serp_snapshots (id) on delete set null;

-- Archived phrases are hidden and not pulled, but keep their ranking history.
alter table public.phrases add column archived_at timestamptz;

-- At most one "running" row per lead. Not a cross-instance lock: the API marks a lead's running rows
-- interrupted before inserting, so only one API instance is supported (see PullDeps.inFlight).
create unique index ranking_pull_runs_one_running_idx on public.ranking_pull_runs (lead_id) where status = 'running';
