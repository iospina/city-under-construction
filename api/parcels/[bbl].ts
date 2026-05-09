// ---------------------------------------------------------------------------
// GET /api/parcels/[bbl]
// Returns every permit row at a single BBL. Used for cold-start hydration
// of /parcel/{bbl} share links — when a user lands on a deep-linked parcel
// page from social, we need that one parcel's data without paying for the
// full citywide fetch.
//
// Returns: an array of RawPermitRow-shaped objects (may be empty if the BBL
// has no active permits).
// ---------------------------------------------------------------------------

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../../lib/db.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const bbl = String(req.query.bbl ?? '').trim();
  if (!bbl) {
    return res.status(400).json({ error: 'Missing bbl parameter' });
  }

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
      WHERE bbl = ${bbl}
    `;

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=600, stale-while-revalidate=1800',
    );
    return res.status(200).json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[GET /api/parcels/${bbl}] failed:`, message);
    return res.status(500).json({ error: message });
  }
}
