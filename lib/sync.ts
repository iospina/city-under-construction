// ---------------------------------------------------------------------------
// lib/sync.ts
// Pure function that pulls all currently active permits from DOB NOW and
// atomically replaces the contents of the `permits` table.
//
// "Currently active" matches CUC's product definition exactly:
//   permit_status = 'Permit Issued'
//   AND (expired_date IS NULL OR expired_date > today)
//
// Pagination: SoQL caps a single page at 50 000 rows. We loop with $offset
// until we get a short page. Today's dataset is ~105 000 rows.
//
// Atomic replacement: TRUNCATE + INSERT in batches inside one transaction.
// Readers see either the previous full snapshot or the new full snapshot —
// never a partial state.
// ---------------------------------------------------------------------------

import { getPool } from './db.js';

const DOB_NOW_URL = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';
const FETCH_PAGE_SIZE = 50_000;
const INSERT_BATCH_SIZE = 500; // 500 × 26 cols = 13 000 placeholders, well under 65 535 PG limit

export interface SyncResult {
  rowsSynced: number;
  pagesFetched: number;
  durationMs: number;
}

interface DobNowRow {
  borough?: string;
  community_board?: string;
  council_district?: string;
  census_tract?: string;
  nta?: string;
  bin?: string;
  bbl?: string;
  house_no?: string;
  street_name?: string;
  job_filing_number?: string;
  job_doc_number?: string;
  tracking_number?: string;
  sequence_number?: string;
  work_permit?: string;
  work_permit_type?: string;
  permit_status?: string;
  filing_reason?: string;
  work_type?: string;
  work_on_floor?: string;
  job_description?: string;
  estimated_job_cost?: string;
  approved_date?: string;
  issued_date?: string;
  expired_date?: string;
  latitude?: string;
  longitude?: string;
}

const COLUMNS = [
  'borough', 'community_board', 'council_district', 'census_tract', 'nta',
  'bin', 'bbl', 'house_no', 'street_name',
  'job_filing_number', 'job_doc_number', 'tracking_number', 'sequence_number',
  'work_permit', 'work_permit_type', 'permit_status', 'filing_reason',
  'work_type', 'work_on_floor', 'job_description', 'estimated_job_cost',
  'approved_date', 'issued_date', 'expired_date', 'latitude', 'longitude',
] as const;

export async function runSync(): Promise<SyncResult> {
  const startedAt = Date.now();

  const rows = await fetchAllActivePermits();
  await replacePermits(rows);

  return {
    rowsSynced: rows.length,
    pagesFetched: Math.ceil(rows.length / FETCH_PAGE_SIZE),
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchAllActivePermits(): Promise<DobNowRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const where =
    `permit_status='Permit Issued' AND ` +
    `(expired_date IS NULL OR expired_date > '${today}')`;

  const all: DobNowRow[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(DOB_NOW_URL);
    url.searchParams.set('$limit', String(FETCH_PAGE_SIZE));
    url.searchParams.set('$offset', String(offset));
    url.searchParams.set('$where', where);
    url.searchParams.set('$order', 'issued_date DESC');

    const headers: HeadersInit = process.env.SOCRATA_APP_TOKEN
      ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN }
      : {};

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(
        `DOB NOW fetch failed at offset ${offset}: ` +
          `${response.status} ${response.statusText}`,
      );
    }

    const page: DobNowRow[] = await response.json();
    all.push(...page);

    if (page.length < FETCH_PAGE_SIZE) break;
    offset += FETCH_PAGE_SIZE;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

async function replacePermits(rows: DobNowRow[]): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE permits');

    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      const { text, values } = buildBatchInsert(batch);
      await client.query(text, values);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

function buildBatchInsert(batch: DobNowRow[]): { text: string; values: unknown[] } {
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  for (const row of batch) {
    const rowPlaceholders = COLUMNS.map(() => `$${p++}`).join(', ');
    placeholders.push(`(${rowPlaceholders})`);
    for (const col of COLUMNS) {
      values.push(row[col] ?? null);
    }
  }

  const text =
    `INSERT INTO permits (${COLUMNS.join(', ')}) VALUES ${placeholders.join(', ')}`;
  return { text, values };
}
