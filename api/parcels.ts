// ---------------------------------------------------------------------------
// GET /api/parcels
// Returns permits whose coordinates fall inside the requested viewport box.
//
// Query params:
//   bbox=minLng,minLat,maxLng,maxLat  — REQUIRED. Caps total area to 1° in
//                                       each dimension. Missing or malformed
//                                       bbox returns 400.
//
// History note: an earlier version of this endpoint returned the entire
// citywide payload (~93 MB raw, ~10 MB gzipped) when called without bbox.
// That branch existed for backward compatibility while the client migrated
// to viewport-aware fetching, and has been removed now that the client is
// fully on bbox. Bookmarks and share-link landings use /api/parcels/[bbl].
//
// Caching: the underlying data only changes once a day after the cron sync,
// so we can hold edge-cached responses for a full day. Vercel's edge cache
// keys on the full URL, so each unique bbox gets its own entry.
// ---------------------------------------------------------------------------

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../lib/db.js';

interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/**
 * Parse and validate `bbox=minLng,minLat,maxLng,maxLat`.
 * Returns null when missing or malformed. Caps total area to 1° in each
 * dimension — NYC fits comfortably in ~0.7° × 0.55°, so 1° rejects
 * pathological worldwide queries while still allowing any zoomed-out
 * city view.
 */
function parseBbox(raw: string | string[] | undefined): Bbox | null {
  if (!raw || Array.isArray(raw)) return null;

  const parts = raw.split(',').map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;

  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLat >= maxLat || minLng >= maxLng) return null;
  if (maxLat - minLat > 1 || maxLng - minLng > 1) return null;

  return { minLng, minLat, maxLng, maxLat };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const bbox = parseBbox(req.query.bbox);
  if (!bbox) {
    return res.status(400).json({
      error:
        'bbox query parameter is required (format: minLng,minLat,maxLng,maxLat; max 1° per dimension)',
    });
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
      WHERE latitude  ~ '^-?[0-9]+(\.[0-9]+)?$'
        AND longitude ~ '^-?[0-9]+(\.[0-9]+)?$'
        AND latitude::double precision  BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
        AND longitude::double precision BETWEEN ${bbox.minLng} AND ${bbox.maxLng}
    `;

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=86400, stale-while-revalidate=86400',
    );
    return res.status(200).json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/parcels] failed:', message);
    return res.status(500).json({ error: message });
  }
}
