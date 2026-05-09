// ---------------------------------------------------------------------------
// GET /api/parcels
// Returns every row in the permits table, in the same shape the client
// already consumes from DOB NOW directly today.
//
// Contract is intentionally identical to RawPermitRow[] so that swapping the
// client's data source is a one-line diff in src/services/dataService.ts.
// Parcel grouping continues to happen client-side via parcelGrouping.ts.
//
// Caching: stale-while-revalidate so most reads hit Vercel's edge cache.
// The underlying data only changes once a day (cron sync), so a 10-minute
// fresh window with a 30-minute stale-revalidate window is safe.
// ---------------------------------------------------------------------------

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db.js';

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const rows = await sql`
      SELECT
        borough, community_board, council_district, census_tract, nta,
        bin, bbl, house_no, street_name,
        job_filing_number, job_doc_number, tracking_number, sequence_number,
        work_permit, work_permit_type, permit_status, filing_reason,
        work_type, work_on_floor, job_description, estimated_job_cost,
        approved_date, issued_date, expired_date, latitude, longitude
      FROM permits
    `;

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=600, stale-while-revalidate=1800',
    );
    return res.status(200).json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/parcels] failed:', message);
    return res.status(500).json({ error: message });
  }
}
