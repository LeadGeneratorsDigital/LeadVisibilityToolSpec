-- Extra demo leads for local development. Safe to re-run: leads that already exist are skipped.

with new_leads as (
  insert into public.leads (business_name, industry, location_code, website_domain, status, date_added)
  select v.business_name, v.industry, v.location_code, v.website_domain, v.status::public.lead_status, v.date_added
  from (values
    ('Pennine Commercial Electrical', 'Electrical Contractors', 'UK', 'penninecommercial.co.uk', 'lead', current_date - 120),
    ('Midland Fire Protection Ltd', 'Fire Safety', 'UK', 'midlandfireprotection.co.uk', 'lead', current_date - 95),
    ('Harbourside Office Interiors', 'Office Fit-out', 'UK', 'harboursideinteriors.co.uk', 'lead', current_date - 80),
    ('Clyde Industrial Coatings', 'Industrial Coatings', 'UK', 'clydecoatings.co.uk', 'lead', current_date - 60),
    ('Thames Valley Pest Control', 'Pest Control', 'UK', 'thamesvalleypest.co.uk', 'lead', current_date - 45),
    ('Yorkshire Waste Solutions', 'Waste Management', 'UK', 'yorkshirewaste.co.uk', 'client', current_date - 150),
    ('Castle Security Systems', 'Security Systems', 'UK', 'castlesecurity.co.uk', 'lead', current_date - 70),
    ('Severn Plumbing & Heating', 'Plumbing & Heating', 'UK', 'severnplumbing.co.uk', 'lead', current_date - 110),
    ('Kent Commercial Glazing', 'Glazing', 'UK', 'kentcommercialglazing.co.uk', 'lead', current_date - 30)
  ) as v(business_name, industry, location_code, website_domain, status, date_added)
  where not exists (select 1 from public.leads l where l.business_name = v.business_name)
  returning id, business_name
),
new_contacts as (
  insert into public.contacts (lead_id, name, job_title, email, sort_order)
  select l.id, c.name, c.job_title, c.email, c.sort_order
  from new_leads l
  join (values
    ('Pennine Commercial Electrical', 'Priya Shah', 'Operations Director', 'priya.shah@penninecommercial.co.uk', 1),
    ('Pennine Commercial Electrical', 'Mark Bentley', 'Managing Director', 'mark@penninecommercial.co.uk', 2),
    ('Midland Fire Protection Ltd', 'Helen Clarke', 'Commercial Manager', 'helen.clarke@midlandfireprotection.co.uk', 1),
    ('Harbourside Office Interiors', 'James Whitfield', 'Founder', 'james@harboursideinteriors.co.uk', 1),
    ('Harbourside Office Interiors', 'Lucy Okafor', 'Marketing Lead', 'lucy@harboursideinteriors.co.uk', 2),
    ('Harbourside Office Interiors', 'Ben Hartley', 'Project Director', 'ben@harboursideinteriors.co.uk', 3),
    ('Clyde Industrial Coatings', 'Iain Murray', 'Founder', 'iain@clydecoatings.co.uk', 1),
    ('Thames Valley Pest Control', 'Rachel Moore', 'Office Manager', 'rachel@thamesvalleypest.co.uk', 1),
    ('Yorkshire Waste Solutions', 'Craig Sutcliffe', 'Sales Director', 'craig@yorkshirewaste.co.uk', 1),
    ('Castle Security Systems', 'Fiona Campbell', 'Director', 'fiona@castlesecurity.co.uk', 1),
    ('Castle Security Systems', 'Ross Mackenzie', 'Technical Manager', 'ross@castlesecurity.co.uk', 2),
    ('Severn Plumbing & Heating', 'Owen Davies', 'Owner', 'owen@severnplumbing.co.uk', 1),
    ('Kent Commercial Glazing', 'Sophie Turner', 'Business Development Manager', 'sophie@kentcommercialglazing.co.uk', 1)
  ) as c(business_name, name, job_title, email, sort_order) on c.business_name = l.business_name
  returning id
),
new_groups as (
  insert into public.buyer_groups (lead_id, name, sort_order)
  select l.id, g.name, g.sort_order
  from new_leads l
  join (values
    ('Pennine Commercial Electrical', 'Commercial Electricians Manchester', 1),
    ('Pennine Commercial Electrical', 'EV Charging', 2),
    ('Midland Fire Protection Ltd', 'Fire Alarm Servicing', 1),
    ('Midland Fire Protection Ltd', 'Sprinkler Systems', 2),
    ('Harbourside Office Interiors', 'Office Fit-out Bristol', 1),
    ('Clyde Industrial Coatings', 'Protective Coatings', 1),
    ('Thames Valley Pest Control', 'Commercial Pest Control', 1),
    ('Yorkshire Waste Solutions', 'Commercial Waste Leeds', 1),
    ('Castle Security Systems', 'CCTV Installation', 1),
    ('Castle Security Systems', 'Access Control', 2),
    ('Severn Plumbing & Heating', 'Commercial Plumbing Cardiff', 1),
    ('Kent Commercial Glazing', 'Commercial Glazing Kent', 1)
  ) as g(business_name, name, sort_order) on g.business_name = l.business_name
  returning id, lead_id, name
)
insert into public.phrases (lead_id, buyer_group_id, phrase_text, sort_order)
select g.lead_id, g.id, p.phrase_text, p.sort_order
from new_groups g
join (values
  ('Commercial Electricians Manchester', 'commercial electrician manchester', 1),
  ('Commercial Electricians Manchester', 'electrical contractors manchester', 2),
  ('Commercial Electricians Manchester', 'office electrical installation', 3),
  ('EV Charging', 'workplace ev charger installation', 1),
  ('EV Charging', 'commercial ev charging installers', 2),
  ('Fire Alarm Servicing', 'fire alarm servicing birmingham', 1),
  ('Fire Alarm Servicing', 'fire alarm maintenance contract', 2),
  ('Fire Alarm Servicing', 'bs 5839 fire alarm inspection', 3),
  ('Sprinkler Systems', 'sprinkler system servicing', 1),
  ('Sprinkler Systems', 'warehouse sprinkler installation', 2),
  ('Office Fit-out Bristol', 'office fit out bristol', 1),
  ('Office Fit-out Bristol', 'office refurbishment bristol', 2),
  ('Office Fit-out Bristol', 'commercial interior design bristol', 3),
  ('Office Fit-out Bristol', 'design and build office fit out', 4),
  ('Protective Coatings', 'industrial floor coatings', 1),
  ('Protective Coatings', 'steel protective coatings scotland', 2),
  ('Protective Coatings', 'intumescent paint contractors', 3),
  ('Commercial Pest Control', 'commercial pest control reading', 1),
  ('Commercial Pest Control', 'restaurant pest control contract', 2),
  ('Commercial Pest Control', 'office pest control services', 3),
  ('Commercial Waste Leeds', 'commercial waste collection leeds', 1),
  ('Commercial Waste Leeds', 'skip hire leeds', 2),
  ('Commercial Waste Leeds', 'business recycling services yorkshire', 3),
  ('CCTV Installation', 'cctv installers edinburgh', 1),
  ('CCTV Installation', 'commercial cctv glasgow', 2),
  ('Access Control', 'access control systems edinburgh', 1),
  ('Access Control', 'door entry systems for offices', 2),
  ('Commercial Plumbing Cardiff', 'commercial plumber cardiff', 1),
  ('Commercial Plumbing Cardiff', 'commercial boiler servicing', 2),
  ('Commercial Glazing Kent', 'commercial glazing kent', 1),
  ('Commercial Glazing Kent', 'shopfront installers', 2),
  ('Commercial Glazing Kent', 'curtain walling contractors', 3)
) as p(group_name, phrase_text, sort_order) on p.group_name = g.name;
