-- Lead Visibility Tool - Stage 1 schema (spec section 5).

create type public.lead_status as enum ('active', 'paused', 'converted');
create type public.pull_status as enum ('running', 'succeeded', 'failed');

create table public.location_codes (
  code text primary key,
  label text not null,
  data4seo_location_code integer not null
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (length(trim(business_name)) > 0),
  industry text,
  location_code text references public.location_codes (code) on update cascade,
  -- Spec section 8: compared against each organic result's domain.
  website_domain text,
  status public.lead_status not null default 'active',
  brief text not null default '',
  date_added date not null default current_date,
  next_email_due date,
  last_ranking_pull timestamptz
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  name text not null,
  job_title text,
  email text not null,
  sort_order integer not null check (sort_order between 1 and 5),
  unique (lead_id, sort_order)
);

create table public.buyer_groups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0
);

create table public.phrases (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  buyer_group_id uuid references public.buyer_groups (id) on delete set null,
  phrase_text text not null check (length(trim(phrase_text)) > 0),
  -- Kept for FRT import parity; the ranking table renders headings from buyer_groups
  -- and the pull skips heading rows.
  is_heading boolean not null default false,
  sort_order integer not null default 0
);

create table public.rankings (
  id uuid primary key default gen_random_uuid(),
  phrase_id uuid not null references public.phrases (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  -- NULL = no data (API error). 101 = not in the top 100.
  position integer check (position is null or position between 1 and 101),
  unique (phrase_id, month)
);

create table public.ranking_pull_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  status public.pull_status not null default 'running',
  phrases_total integer not null default 0,
  phrases_done integer not null default 0,
  phrases_failed integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index contacts_lead_id_idx on public.contacts (lead_id);
create index buyer_groups_lead_id_idx on public.buyer_groups (lead_id);
create index phrases_lead_id_idx on public.phrases (lead_id);
create index rankings_phrase_month_idx on public.rankings (phrase_id, month desc);
create index ranking_pull_runs_lead_started_idx on public.ranking_pull_runs (lead_id, started_at desc);

-- Spec section 7: single admin role - every authenticated user sees and edits everything.
do $$
declare t text;
begin
  foreach t in array array['location_codes','leads','contacts','buyer_groups','phrases','rankings','ranking_pull_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end $$;
