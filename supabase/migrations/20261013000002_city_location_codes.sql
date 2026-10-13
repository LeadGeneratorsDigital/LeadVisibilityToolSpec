-- Real DataForSEO codes replace the UK-wide 2826 placeholder, so each city ranks on its own local SERP.
-- From GET /v3/serp/google/locations/gb on 2026-10-13: location_type "City", Kent "County" (Kent,England).
insert into public.location_codes (code, label, data4seo_location_code) values
  ('MAN', 'Manchester', 1006912),
  ('BHM', 'Birmingham', 1006524),
  ('LDS', 'Leeds', 1006864),
  ('BRS', 'Bristol', 1006567),
  ('GLA', 'Glasgow', 1007336),
  ('EDI', 'Edinburgh', 1007326),
  ('CDF', 'Cardiff', 1007416),
  ('RDG', 'Reading', 1007009),
  ('KEN', 'Kent', 9041088)
on conflict (code) do update set label = excluded.label, data4seo_location_code = excluded.data4seo_location_code;
