# City Permits

A civic data tool that surfaces NYC's currently-active construction permits
on a map. Search any address and see what's actually being built there.

Live: [citypermits.vercel.app](https://citypermits.vercel.app)

## Architecture

A daily Vercel Cron job pulls every active permit from the NYC DOB NOW
dataset (`rbx6-tga4`) into a CUC-owned Postgres database (Neon). The Vite +
React client reads from CUC's API endpoints, never directly from DOB NOW.

```
                                 +---------------------+
  data.cityofnewyork.us  --->    |  /api/cron/         |
  (DOB NOW rbx6-tga4)            |     sync-permits    |  daily 04:00 ET
                                 +----------+----------+
                                            |
                                            v
                                     Neon Postgres
                                     (permits table)
                                            |
                                            v
                                 +---------------------+
                                 |  /api/parcels       |  list-all
                                 |  /api/parcels/[bbl] |  per-BBL
                                 +----------+----------+
                                            |
                                            v
                                     React client (Vite)
```

"Active" matches CUC's product definition exactly:
`permit_status = 'Permit Issued' AND (expired_date IS NULL OR expired_date > today)`.

## Local development

You need:

- Node 20+
- A Neon Postgres project (free tier is fine) — get the pooled connection
  string from the project dashboard.
- A Mapbox token for the client geocoder.
- Optional: a Socrata app token for un-rate-limited DOB NOW fetches.

```bash
cp .env.example .env.local
# fill in DATABASE_URL, VITE_MAPBOX_ACCESS_TOKEN, etc.

npm install
npm run db:init     # apply db/schema.sql
npm run db:sync     # populate the permits table from DOB NOW (~30–60s)

npm run dev:full    # vercel dev — Vite + /api routes on one port
# or
npm run dev         # vite only — client works but /api routes return 404
```

`npm run dev:full` requires the Vercel CLI: `npm i -g vercel`, then `vercel link`.

## Deployment

Production deployment is on Vercel.

- The cron schedule and `maxDuration` for the sync handler are configured in
  `vercel.json`.
- Vercel Cron requires the **Pro** plan; free Hobby allows daily-cadence
  cron but caps function `maxDuration` at 60s, which is too tight for a
  full sync.
- Required production env vars: `DATABASE_URL`, `CRON_SECRET`,
  `SOCRATA_APP_TOKEN` (optional), `VITE_MAPBOX_ACCESS_TOKEN`,
  `VITE_POSTHOG_KEY` (optional).
- `CRON_SECRET` should be a long random string (`openssl rand -hex 32`),
  set identically in Vercel env vars and in `.env.local`. Vercel sends it
  to the cron endpoint as `Authorization: Bearer …`.

Realistic monthly cost: ~$20 (Vercel Pro). Database is on Neon free tier.

## Repository layout

```
api/                     Vercel serverless functions
  cron/sync-permits.ts   Daily cron → fills the permits table
  parcels.ts             GET /api/parcels — list-all
  parcels/[bbl].ts       GET /api/parcels/:bbl — single BBL
db/
  schema.sql             permits table definition (idempotent CREATEs)
lib/
  db.ts                  Neon client (sql + Pool)
  sync.ts                runSync() — used by the cron handler and the CLI
scripts/
  init-db.ts             Apply db/schema.sql (npm run db:init)
  sync.ts                Run sync against DATABASE_URL (npm run db:sync)
src/                     Vite + React client
```

## Data & filters

The single source of truth is the
[DOB NOW: Build Approved Permits](https://data.cityofnewyork.us/Housing-Development/DOB-NOW-Build-Approved-Permits/rbx6-tga4)
dataset. CUC does not pull the legacy DOB BIS (`ipu4-2q9a`) feed, the
Electrical, Elevator, or LAA datasets.

The May 2026 audit (Notion: *CUC Permit Data Audit, May 2026*) documents
how the previous browser-only architecture silently truncated to ~22 days
of issuance citywide. The architecture above eliminates that truncation as
a structural limit.
