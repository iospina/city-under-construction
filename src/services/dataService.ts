// ---------------------------------------------------------------------------
// dataService.ts
// Fetches permit rows from the CUC-owned API endpoint.
//
// History: pre-Brooklyn-Mirage-launch this file fetched directly from the
// NYC Open Data API (rbx6-tga4) from the browser, capped at 10 000 rows.
// The May 2026 audit revealed that cap was silently dropping ~90% of active
// permits citywide. The fix was structural: a server-side daily sync into a
// CUC-owned Postgres database, with the client reading from a CUC endpoint.
// See db/schema.sql, lib/sync.ts, and api/parcels.ts.
//
// Slim-payload migration (May 2026): the client now requests permits by
// viewport bbox instead of pulling the full citywide payload (~93 MB raw).
// Single-BBL fetches via /api/parcels/[bbl] cover the few paths that need
// a specific parcel regardless of viewport — share-link landings, browser
// back/forward to a /parcel/{bbl} URL, alias-suggestion resolution.
// ---------------------------------------------------------------------------

import type { RawPermitRow } from '../types';

const PARCELS_ENDPOINT = '/api/parcels';

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/**
 * Fetch the active permits whose coordinates fall inside `bbox`.
 *
 * "Active" matches CUC's product definition exactly:
 *   permit_status = 'Permit Issued'
 *   AND (expired_date IS NULL OR expired_date > today)
 *
 * The server enforces this filter during the daily sync, so the client
 * receives only currently-active rows.
 *
 * Bbox is `[minLng, minLat, maxLng, maxLat]` in decimal degrees. The server
 * rejects bboxes larger than 1° in either dimension (returns an empty payload).
 */
export async function fetchPermitRowsInBbox(bbox: Bbox): Promise<RawPermitRow[]> {
  const params = new URLSearchParams({
    bbox: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
  });
  const url = `${PARCELS_ENDPOINT}?${params.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch permits in bbox: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as RawPermitRow[];
}

/**
 * Fetch every permit row at a single BBL. Used for paths that need a
 * specific parcel regardless of viewport: cold-start `/parcel/{bbl}`
 * hydration, browser back/forward, alias resolution from search.
 *
 * Returns an empty array if the BBL has no active permits.
 */
export async function fetchPermitRowsForBbl(bbl: string): Promise<RawPermitRow[]> {
  const url = `${PARCELS_ENDPOINT}/${encodeURIComponent(bbl)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch permits for BBL ${bbl}: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as RawPermitRow[];
}
