# Lead Visibility Tool

A private web app for LeadGenerators Digital that tracks where each prospect's website appears on
Google for the key phrases their buyers search, month by month. It replaces the old FRT Google Sheet.

Stage 1 covers:

- **Sign in.** One user, email and password, with no public sign-up.
- **Leads list.** Company, industry, location, visibility, last ranking update and status (Lead or
  Client), with search and sorting on every column.
- **Lead page.**
  - Details and up to five contacts, with **Copy all emails** (separated by semicolons for Outlook).
  - Key phrases grouped under one level of free-text headings; a phrase can be moved under another
    heading with its ranking history.
  - The monthly ranking table: green for positions 1-20, mustard for 21-100, and red "Not Ranked"
    outside the top 100.
  - **Update rankings.** Manual, one prospect at a time.
  - **Copy as CSV** of the whole ranking table.
- **CSV import** of leads and contacts.
- **One-time import of the old FRT workbook** (leads, contacts, headings, phrases and past rankings).

## How it is built

| Part | What it is | Hosted on |
|---|---|---|
| `apps/web` | The pages: React + Vite + Tailwind. Talks to Supabase directly for data and sign-in. | Render static site |
| `apps/api` | A small Fastify server. Its only job is the DataForSEO ranking check, so the DataForSEO password never reaches the browser. | Render web service (free) |
| `packages/shared` | Rules used by both: visibility bands, month handling, reading DataForSEO results, the CSV copy. | - |
| `supabase/migrations` | The database, as numbered SQL files. Running them in order rebuilds it from nothing. | Supabase (free) |

The database tables are `leads`, `contacts` (at most 5 per lead), `buyer_groups` (the headings),
`phrases`, `rankings` (one row per phrase per month), `ranking_pull_runs` (progress of each
**Update rankings**), `serp_snapshots` (raw Google results kept for 3 months, then deleted by a
daily `pg_cron` job) and `location_codes`. Every table allows the signed-in user only (row-level
security). The API uses the service-role key.

### How Update rankings works

1. The browser calls `POST /api/leads/:id/pull` with the user's Supabase session token.
2. For every phrase, the API asks DataForSEO for the top 100 Google results in the lead's country
   (Google UK, Google South Africa or Google USA). It looks for the lead's website, subdomains
   included, and saves the position under the current month (Europe/London calendar).
   - A phrase that is not found counts as Not Ranked (position 101).
   - A phrase whose check fails is left blank.
3. The first update of a month only checks phrases with no result for that month yet. It also
   reuses a Google result saved this month, in the last 7 days, for the same phrase and country, so the
   duplicate costs nothing. Clicking again in the same month asks for confirmation, then checks
   every phrase again and replaces that month's results.

Each phrase check is one paid DataForSEO request on the client's account.

## Running it locally

You need Node 22 and pnpm 10 (`corepack enable`). For a local database you also need the
[Supabase CLI](https://supabase.com/docs/guides/cli) with Docker.

```sh
pnpm install
supabase start                # local Postgres + auth; prints the URL and keys
supabase db reset             # runs every migration, then supabase/seed.sql and demo-leads.sql
cp apps/api/.env.example apps/api/.env   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
cp apps/web/.env.example apps/web/.env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
pnpm create-user you@example.com a-long-password
pnpm dev                      # web on http://localhost:5173, API on :8787 (DataForSEO mocked)
```

Before every change:

```sh
pnpm typecheck
pnpm test
```

## Environment variables

### API (`apps/api/.env` locally, the `lead-visibility-api` service on Render)

| Variable | Required | What it does |
|---|---|---|
| `SUPABASE_URL` | yes | The Supabase project URL (`https://<ref>.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only key that bypasses row-level security. Never put it in the web app. |
| `DATAFORSEO_MODE` | no, default `mock` | `live` = the real API. `sandbox` = DataForSEO's free sandbox with dummy results. `mock` = generated results, no network. Production refuses anything but `live` unless `ALLOW_MOCKS=true`. |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | in `live` and `sandbox` | The **API** login and password from DataForSEO's API Access page. These are not the dashboard login. |
| `CORS_ORIGIN` | no, default `http://localhost:5173` | Comma-separated web addresses allowed to call the API. |
| `PORT` | no, default `8787` | Port to listen on (Render sets it). |
| `NODE_ENV` | no | `production` on Render (`pnpm start` sets it). |
| `ALLOW_MOCKS` | no, default `false` | `true` lets a production build run on mock or sandbox data, for a demo deploy only. |
| `PULL_CONCURRENCY` | no, default `10` | Phrases checked at the same time (DataForSEO allows 30 per account). |
| `DATAFORSEO_TIMEOUT_MS` | no, default `120000` | Per-phrase timeout; a timed-out phrase is left blank. |
| `MOCK_ERROR_RATE`, `MOCK_LATENCY_MS` | no | Only used in `mock` mode. |
| `WEB_DIST` | no | Serves a built web app from the API as well (single-host deploys). Not used on Render. |

### Web (`apps/web/.env` locally, the `lead-visibility-web` static site on Render)

These are built into the page, so they must be safe to publish.

| Variable | Required | What it does |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Same project URL as the API. |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase's public "anon" key; row-level security limits it to the signed-in user. |
| `VITE_API_URL` | in production | The API address, e.g. `https://lead-visibility-api.onrender.com`. Leave empty locally: Vite forwards `/api` to `:8787`. |

### GitHub (repository variable, not a secret)

| Variable | What it does |
|---|---|
| `API_URL` | The API address. The daily **Keep Supabase awake** workflow calls `$API_URL/api/keepalive`. |

## Deploying

The first time:

1. **Supabase.**
   - Create a project (London region).
   - Link it and run the migrations: `supabase link --project-ref <ref>` then `supabase db push`.
     The seed files are for local demos only; `db push` does not run them.
   - Under Authentication:
     - Turn off "Allow new users to sign up".
     - Set the Site URL to `https://rankings.leadgenerators.co.uk`.
2. **Render.**
   - Create a Blueprint from this repository; it reads `render.yaml` and creates both services.
   - Fill in the variables marked `sync: false`.
   - `CORS_ORIGIN` lists `https://lead-visibility-web.onrender.com`. If Render gives the static
     site a different `onrender.com` address (the name was taken), put that address there instead.
   - The free plan does not allow inviting a second member, so share the Render login through a
     password manager.
3. **Domain.**
   - In Render, open the `lead-visibility-web` service, then Settings, then Custom Domains. It
     shows the CNAME target for `rankings.leadgenerators.co.uk`.
   - Add that CNAME record (host `rankings`) in SiteGround's DNS zone editor.
   - Render issues the HTTPS certificate once the record resolves.
4. **User.** With `apps/api/.env` pointing at the production project, run
   `pnpm create-user <email> <password>`.
5. **Keep-alive.** Set the `API_URL` repository variable in GitHub, then run **Keep Supabase
   awake** once from the Actions tab to check it.
   - Supabase still emails a warning before pausing a project, and a paused project can be resumed
     from its dashboard with all data intact.
   - If the workflow is ever disabled (GitHub turns scheduled workflows off on inactive public
     repositories), re-enable it from the Actions tab.

After that, Render redeploys both services on every push to `main`. New migrations are applied
with `supabase db push`.

## Importing the old FRT workbook

This is a one-time move from the old Google Sheet. Export it as `.xlsx`, then from `apps/api`
(with `.env` pointing at the target project):

```sh
pnpm import-frt "/path/to/FRT Management Dashboard.xlsx"                               # dry run: writes nothing
pnpm import-frt "/path/to/FRT Management Dashboard.xlsx" --apply --target <project-ref>   # writes
```

### What it imports

| Source in the workbook | Imported as |
|---|---|
| Each visible tab in the `BUSINESS & SETTINGS` layout | One lead |
| Name, website, contacts (rows 9-11) | Lead details and contacts |
| D4 (Google UK / SA / USA) | Location: UK, South Africa or United States |
| Bold rows in column B | Headings |
| Other rows in column B | Key phrases |
| Every month column (row 15) | Past rankings |

- A stacked ALL-CAPS section heading is joined onto each heading under it ("SECTION — Heading"),
  because the app has one level of headings.
- Positions above 100, "Not Ranked" and "Not in the Top 100" are all stored as Not Ranked.
- An imported lead's "Last ranking update" is the 1st of its latest month with data.
- Every lead is imported as status Lead. Set clients on their lead page.

### What it skips

- Hidden tabs, template tabs, other layouts, and a second tab with the same business name.
- A lead whose name already exists, so the command can be run again safely.

### Before and after the run

- The command prints a summary and writes `frt-import-report.json`.
  - The report lists every lead and every warning: a duplicate phrase, a missing website or email,
    a value that is not a ranking.
  - The report is gitignored because it holds contact emails.
- Read the dry run's warnings and fix the workbook before using `--apply`.
- `--apply` refuses to run unless `--target` matches the project in `SUPABASE_URL` (the
  `<ref>` of `https://<ref>.supabase.co`), so a `.env` left pointing at another project cannot be
  written to by mistake.
- A month heading that appears twice in a tab keeps its first column; the second is left out with
  a warning.
- A lead that fails part-way is removed again, so a re-run imports it fresh. If that removal fails
  too, the error names the lead to delete by hand.
- A run stops after 3 failed leads in a row.

## Ownership and secrets

No password, API key or other secret is stored in this repository. `.env` files are gitignored;
production values live only in Render's environment settings. After handover:

- Change the Render password.
- Remove the developer from the Supabase organisation and the GitHub organisation.
- Rotate the DataForSEO API password. The app only needs `DATAFORSEO_PASSWORD` updated on Render.
