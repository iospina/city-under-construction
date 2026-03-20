// ---------------------------------------------------------------------------
// dataService.ts
// Fetches raw permit rows from the NYC Open Data API (dataset rbx6-tga4).
// ---------------------------------------------------------------------------

import type { RawPermitRow } from '../types';

const API_BASE = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';

/**
 * Fetch permit rows from NYC Open Data.
 *
 * Filters server-side to active permits only (permit_status = 'Permit Issued'
 * AND not yet expired) so the full row budget goes to genuinely live sites.
 * Results are ordered by issued_date DESC so the freshest permits surface
 * first if the dataset ever grows beyond the limit.
 *
 * @param limit  Maximum rows to fetch. Default 50 000 — enough to cover all
 *               active DOB NOW permits city-wide with room to spare.
 * @param offset Optional offset for future pagination.
 */
export async function fetchPermitRows(
  limit = 50000,
  offset = 0,
): Promise<RawPermitRow[]> {
  // Today's date in ISO format for the expiry boundary (server-side filter).
  const today = new Date().toISOString().slice(0, 10);

  // SoQL WHERE clause: active status + not yet expired.
  const where =
    `permit_status='Permit Issued' AND ` +
    `(expired_date IS NULL OR expired_date > '${today}')`;

  const url = new URL(API_BASE);
  url.searchParams.set('$limit', String(limit));
  url.searchParams.set('$offset', String(offset));
  url.searchParams.set('$where', where);
  url.searchParams.set('$order', 'issued_date DESC');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `Failed to fetch permits: ${response.status} ${response.statusText}`,
    );
  }

  const data: RawPermitRow[] = await response.json();
  return data;
}
