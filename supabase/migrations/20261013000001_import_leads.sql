-- CSV import: creates every lead and its contacts in one transaction, so a failure part-way
-- leaves nothing behind and the same file can simply be uploaded again.
create function public.import_leads(p_leads jsonb)
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
    insert into public.leads (business_name, website_domain, industry, location_code, status, next_email_due)
    values (
      v_lead ->> 'business_name',
      v_lead ->> 'website_domain',
      v_lead ->> 'industry',
      v_lead ->> 'location_code',
      coalesce((v_lead ->> 'status')::public.lead_status, 'active'),
      (v_lead ->> 'next_email_due')::date
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

revoke execute on function public.import_leads(jsonb) from public, anon;
grant execute on function public.import_leads(jsonb) to authenticated;
