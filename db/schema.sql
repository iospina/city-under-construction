-- ---------------------------------------------------------------------------
-- City Permits — permits schema
-- ---------------------------------------------------------------------------
-- Mirrors the fields the client today uses from DOB NOW (rbx6-tga4).
-- All permit-level columns stored as TEXT — the client receives strings today
-- (RawPermitRow types are string-typed) and converts where needed; storing as
-- TEXT keeps the sync path conversion-free and avoids parse-time bugs.
--
-- Sync strategy: TRUNCATE + INSERT inside a transaction once per day.
-- No upserts. No surrogate uniqueness constraints. Reads only run during
-- the brief moment between COMMIT-ing the new contents and the next sync.
--
-- Indexes: only what reads need.
--   idx_permits_bbl  — every parcel-detail read filters by BBL.
--   idx_permits_geo  — viewport-filtered /api/parcels reads. Functional index
--                      on numeric casts of latitude/longitude. Partial filter
--                      excludes rows with empty or non-numeric coords so the
--                      cast never fails (DOB NOW occasionally emits empty
--                      coords for filings on BBLs without geocoded addresses).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS permits (
  id BIGSERIAL PRIMARY KEY,

  -- parcel context
  borough            TEXT,
  community_board    TEXT,
  council_district   TEXT,
  census_tract       TEXT,
  nta                TEXT,
  bin                TEXT,
  bbl                TEXT,
  house_no           TEXT,
  street_name        TEXT,

  -- permit identity
  job_filing_number  TEXT,
  job_doc_number     TEXT,
  tracking_number    TEXT,
  sequence_number    TEXT,
  work_permit        TEXT,
  work_permit_type   TEXT,

  -- permit status / type
  permit_status      TEXT,
  filing_reason      TEXT,
  work_type          TEXT,
  work_on_floor      TEXT,
  job_description    TEXT,
  estimated_job_cost TEXT,

  -- dates (stored as TEXT — client parses)
  approved_date      TEXT,
  issued_date        TEXT,
  expired_date       TEXT,

  -- coordinates
  latitude           TEXT,
  longitude          TEXT,

  -- meta
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permits_bbl ON permits (bbl);

CREATE INDEX IF NOT EXISTS idx_permits_geo
  ON permits ((latitude::double precision), (longitude::double precision))
  WHERE latitude  ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND longitude ~ '^-?[0-9]+(\.[0-9]+)?$';

-- Backs the house-number search fallback (/api/search). BTREE supports the
-- `house_no LIKE 'NN%'` prefix lookups we use when the user's query is
-- purely numeric — Mapbox's geocoder doesn't autocomplete bare house numbers,
-- so we fall back to our own index.
CREATE INDEX IF NOT EXISTS idx_permits_house_no ON permits (house_no);
