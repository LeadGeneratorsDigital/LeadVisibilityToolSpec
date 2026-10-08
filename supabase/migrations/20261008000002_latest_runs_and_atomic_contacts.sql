-- Latest pull run per lead for the dashboard. security_invoker applies the caller's RLS on ranking_pull_runs.
create view public.latest_pull_runs with (security_invoker = true) as
  select distinct on (lead_id) *
  from public.ranking_pull_runs
  order by lead_id, started_at desc;

revoke all on public.latest_pull_runs from anon;
grant select on public.latest_pull_runs to authenticated;

-- Replaces a lead's contacts. One call is one transaction, so a failed insert keeps the old contacts.
create function public.save_contacts(p_lead_id uuid, p_contacts jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.contacts where lead_id = p_lead_id;
  insert into public.contacts (lead_id, name, job_title, email, sort_order)
  select p_lead_id, c.value ->> 'name', c.value ->> 'job_title', c.value ->> 'email', c.ordinality
  from jsonb_array_elements(p_contacts) with ordinality as c(value, ordinality);
end;
$$;

revoke execute on function public.save_contacts(uuid, jsonb) from public, anon;
grant execute on function public.save_contacts(uuid, jsonb) to authenticated;
