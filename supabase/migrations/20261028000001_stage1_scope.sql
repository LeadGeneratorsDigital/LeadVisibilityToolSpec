-- Stage 1 scope as agreed with the client (email thread "FRT: Stage 1 Email and Responses", Oct 2026).

-- 1. Locations are countries. DataForSEO checks the whole country; town targeting lives in the phrase
--    ("art restorer Barnet"). Every earlier code was a UK city or the UK itself, so leads move to UK.
insert into public.location_codes (code, label, data4seo_location_code) values
  ('UK', 'United Kingdom', 2826),
  ('ZA', 'South Africa', 2710),
  ('US', 'United States', 2840)
on conflict (code) do update set label = excluded.label, data4seo_location_code = excluded.data4seo_location_code;

update public.leads set location_code = 'UK' where location_code not in ('UK', 'ZA', 'US');
delete from public.location_codes where code not in ('UK', 'ZA', 'US');

-- 2. Status is Lead or Client. An enum value cannot be dropped in place, so the type is rebuilt.
create type public.lead_status_v2 as enum ('lead', 'client');
alter table public.leads alter column status drop default;
alter table public.leads
  alter column status type public.lead_status_v2
  using (case when status::text = 'converted' then 'client' else 'lead' end)::public.lead_status_v2;
drop type public.lead_status;
alter type public.lead_status_v2 rename to lead_status;
alter table public.leads alter column status set default 'lead';

-- 3. No Brief section and no follow-up dates in Stage 1.
alter table public.leads drop column brief;
alter table public.leads drop column next_email_due;

create or replace function public.import_leads(p_leads jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead jsonb;
  v_lead_id uuid;
  v_count integer := 0;
begin
  for v_lead in select value from jsonb_array_elements(p_leads) with ordinality as l(value, ordinality) order by ordinality
  loop
    insert into public.leads (business_name, website_domain, industry, location_code, status)
    values (
      v_lead ->> 'business_name',
      v_lead ->> 'website_domain',
      v_lead ->> 'industry',
      v_lead ->> 'location_code',
      coalesce((v_lead ->> 'status')::public.lead_status, 'lead')
    )
    returning id into v_lead_id;

    insert into public.contacts (lead_id, name, job_title, email, sort_order)
    select v_lead_id, c.value ->> 'name', c.value ->> 'job_title', c.value ->> 'email', c.ordinality
    from jsonb_array_elements(coalesce(v_lead -> 'contacts', '[]'::jsonb)) with ordinality as c(value, ordinality);

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
