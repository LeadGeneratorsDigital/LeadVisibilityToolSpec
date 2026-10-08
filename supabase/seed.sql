-- Demo data. Location codes must be re-checked against
-- GET https://api.dataforseo.com/v3/serp/google/locations before going live.
insert into public.location_codes (code, label, data4seo_location_code) values
  ('UK', 'United Kingdom', 2826),
  ('LON', 'London', 1006886);

with lead_rows as (
  insert into public.leads (business_name, industry, location_code, website_domain, status, brief, next_email_due)
  values
    ('BrightClean Industrial Ltd', 'Industrial Cleaning', 'LON', 'brightcleanindustrial.co.uk', 'active',
     'Family-run contract cleaning firm, 40 staff. Wants more warehouse and factory contracts. MD is Sarah Cole.',
     current_date + 3),
    ('Apex Scaffolding Services', 'Scaffolding', 'LON', 'apexscaffold.co.uk', 'active',
     '', current_date + 10),
    ('Northern Roofing Co', 'Roofing', 'UK', 'northernroofingco.co.uk', 'paused',
     'Paused until January - owner busy with a large commercial job.', null)
  returning id, business_name
),
contact_rows as (
  insert into public.contacts (lead_id, name, job_title, email, sort_order)
  select l.id, c.name, c.job_title, c.email, c.sort_order
  from lead_rows l
  join (values
    ('BrightClean Industrial Ltd', 'Sarah Cole', 'Managing Director', 'sarah@brightcleanindustrial.co.uk', 1),
    ('BrightClean Industrial Ltd', 'Tom Hughes', 'Operations Manager', 'tom@brightcleanindustrial.co.uk', 2),
    ('Apex Scaffolding Services', 'Dan Price', 'Owner', 'dan@apexscaffold.co.uk', 1),
    ('Northern Roofing Co', 'Gary Wilson', null, 'gary@northernroofingco.co.uk', 1)
  ) as c(business_name, name, job_title, email, sort_order) on c.business_name = l.business_name
  returning id
),
group_rows as (
  insert into public.buyer_groups (lead_id, name, sort_order)
  select l.id, g.name, g.sort_order
  from lead_rows l
  join (values
    ('BrightClean Industrial Ltd', 'Industrial Cleaning Contracts London', 1),
    ('BrightClean Industrial Ltd', 'Warehouse Cleaning', 2),
    ('Apex Scaffolding Services', 'Commercial Scaffolding London', 1),
    ('Northern Roofing Co', 'Commercial Roofing', 1)
  ) as g(business_name, name, sort_order) on g.business_name = l.business_name
  returning id, lead_id, name
)
insert into public.phrases (lead_id, buyer_group_id, phrase_text, sort_order)
select g.lead_id, g.id, p.phrase_text, p.sort_order
from group_rows g
join (values
  ('Industrial Cleaning Contracts London', 'contract cleaning services london', 1),
  ('Industrial Cleaning Contracts London', 'industrial cleaning company london', 2),
  ('Industrial Cleaning Contracts London', 'factory cleaning contractors', 3),
  ('Warehouse Cleaning', 'warehouse cleaning services', 1),
  ('Warehouse Cleaning', 'warehouse floor cleaning london', 2),
  ('Commercial Scaffolding London', 'scaffolding hire london', 1),
  ('Commercial Scaffolding London', 'commercial scaffolding contractors', 2),
  ('Commercial Scaffolding London', 'temporary roof scaffolding', 3),
  ('Commercial Roofing', 'commercial roofing contractors uk', 1),
  ('Commercial Roofing', 'flat roof repair company', 2)
) as p(group_name, phrase_text, sort_order) on p.group_name = g.name;

-- Ranking history is written by `pnpm --filter @lvt/api seed-history` so it follows the
-- same generator as the mock DataForSEO client.

update public.leads
set last_ranking_pull = (date_trunc('month', current_date) - interval '1 month' + interval '2 days 9 hours')
where status <> 'paused';
