// ---------------------------------------------------------------------------
// parcelGrouping.ts
//
// Transforms raw NYC API permit rows into Parcel objects.
//
// Pipeline (from Build Data Schema):
//   1. Group all permit rows by BBL
//   2. Create one Parcel per BBL
//   3. Populate parcel-level fields using values from any permit row for
//      that BBL (they are identical across rows).
//   4. Attach Permit objects, splitting into activePermits / permitHistory
//   5. Derive latestPermitSummary from the active permit with the most
//      recent issuedDate (falling back to approvedDate).
// ---------------------------------------------------------------------------

import type { RawPermitRow, Permit, Parcel } from '../types';
import { isPermitActive } from './permitStatus';

// ---- helpers ---------------------------------------------------------------

function toNumber(val: string | undefined): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function safeString(val: string | undefined): string {
  return val ?? '';
}

/**
 * Build a display address from house number + street name.
 */
function buildDisplayAddress(row: RawPermitRow): string {
  const house = safeString(row.house_number).trim();
  const street = safeString(row.street_name).trim();
  if (house && street) return `${house} ${street}`;
  if (street) return street;
  return house || 'Unknown address';
}

// ---- core ------------------------------------------------------------------

/**
 * Convert a raw API row into a Permit object.
 */
function toPermit(row: RawPermitRow): Permit {
  const active = isPermitActive(
    safeString(row.permit_status),
    row.expired_date,
  );

  return {
    trackingNumber: safeString(row.tracking_number),
    jobFilingNumber: safeString(row.job_filing_number),
    sequenceNumber: toNumber(row.sequence_number),
    permitStatus: safeString(row.permit_status),
    workPermitText: safeString(row.work_permit_type),
    filingReason: safeString(row.filing_reason),
    workType: safeString(row.work_type),
    workLocation: safeString(row.work_on_floor),
    jobDescription: safeString(row.job_description),
    estimatedJobCost: toNumber(row.estimated_job_cost),
    approvedDate: safeString(row.approved_date),
    issuedDate: safeString(row.issued_date),
    expiredDate: safeString(row.expired_date),
    isActive: active,
  };
}

/**
 * Pick the best row for populating parcel-level fields.
 * We prefer a row that has valid lat/lng, falling back to any row.
 */
function pickParcelRow(rows: RawPermitRow[]): RawPermitRow {
  const withCoords = rows.find(
    (r) => r.latitude && r.longitude && r.latitude !== '0' && r.longitude !== '0',
  );
  return withCoords ?? rows[0];
}

/**
 * Derive latestPermitSummary from the active permit with the most recent
 * issuedDate, falling back to approvedDate.
 */
function deriveLatestPermitSummary(activePermits: Permit[]): string | null {
  if (activePermits.length === 0) return null;

  const sorted = [...activePermits].sort((a, b) => {
    const dateA = a.issuedDate || a.approvedDate;
    const dateB = b.issuedDate || b.approvedDate;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  const latest = sorted[0];
  return latest.workPermitText || latest.jobDescription || null;
}

// ---- public API ------------------------------------------------------------

/**
 * Group raw permit rows by BBL and produce Parcel objects.
 */
export function groupRowsIntoParcels(rows: RawPermitRow[]): Parcel[] {
  // Step 1 — group by BBL
  const groups = new Map<string, RawPermitRow[]>();

  for (const row of rows) {
    const bbl = safeString(row.bbl);
    if (!bbl) continue; // skip rows without a BBL

    const existing = groups.get(bbl);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(bbl, [row]);
    }
  }

  // Step 2 — build Parcel objects
  const parcels: Parcel[] = [];

  for (const [bbl, groupRows] of groups) {
    const representative = pickParcelRow(groupRows);

    const permits = groupRows.map(toPermit);
    const active = permits.filter((p) => p.isActive);
    const history = permits.filter((p) => !p.isActive);

    const lat = toNumber(representative.latitude);
    const lng = toNumber(representative.longitude);

    parcels.push({
      parcelId: bbl, // BBL is the unique parcel identifier
      bbl,
      displayAddress: buildDisplayAddress(representative),
      borough: safeString(representative.borough),
      nta: safeString(representative.nta),
      censusTract: safeString(representative.census_tract),
      communityBoard: safeString(representative.community_board),
      councilDistrict: safeString(representative.council_district),
      latitude: lat,
      longitude: lng,
      hasActivePermit: active.length > 0,
      activePermits: active,
      permitHistory: history,
      latestPermitSummary: deriveLatestPermitSummary(active),
    });
  }

  return parcels;
}
