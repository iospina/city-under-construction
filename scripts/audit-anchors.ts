// ---------------------------------------------------------------------------
// scripts/audit-anchors.ts
// Diagnostic: print active permits at each of the three Brooklyn-Mirage-launch
// anchor addresses, in one shot, against the local Neon DB.
//
//   npm run db:audit-anchors
//
// Anchors (from the engineering brief):
//   1. 140 Stewart Ave, Brooklyn   — Brooklyn Mirage / Pacha New York
//   2. 124 White St,    Manhattan  — Chinatown Jail (final piece of Rikers closure)
//   3. 175 Park Ave,    Manhattan  — RXR/TF Cornerstone supertall (3.2M sqft)
//
// Expected behavior after the row-cap fix:
//   - 140 Stewart: ~14 active permits (matches May 2026 audit baseline)
//   - 124 White:  small handful (construction just started late April 2026)
//   - 175 Park:   substantial — foundation, structure, façade, MEP across
//                 a multi-year megaproject
//
// If any anchor returns 0 rows at the exact (house, street, borough) tuple,
// the script falls back to listing other house numbers on the same street so
// we can spot-check whether DOB NOW uses a different label for the lot.
// ---------------------------------------------------------------------------

import { Pool } from '@neondatabase/serverless';

interface Anchor {
  label: string;
  borough: string;
  house: string;
  street: string;
}

const ANCHORS: Anchor[] = [
  {
    label: '140 Stewart Ave, Brooklyn (Brooklyn Mirage / Pacha New York)',
    borough: 'BROOKLYN',
    house: '140',
    street: 'STEWART AVENUE',
  },
  {
    label: '124 White St, Manhattan (Chinatown Jail / Rikers closure)',
    borough: 'MANHATTAN',
    house: '124',
    street: 'WHITE STREET',
  },
  {
    label: '175 Park Ave, Manhattan (RXR / TF Cornerstone supertall)',
    borough: 'MANHATTAN',
    house: '175',
    street: 'PARK AVENUE',
  },
];

interface Row {
  bbl: string | null;
  work_permit: string | null;
  work_type: string | null;
  issued_date: string | null;
  expired_date: string | null;
  house_no: string | null;
  street_name: string | null;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    for (const a of ANCHORS) {
      console.info(`\n=== ${a.label} ===`);

      const { rows } = await pool.query<Row>(
        `SELECT bbl, work_permit, work_type, issued_date, expired_date,
                house_no, street_name
           FROM permits
          WHERE borough = $1 AND street_name = $2 AND house_no = $3
          ORDER BY issued_date DESC`,
        [a.borough, a.street, a.house],
      );

      if (rows.length === 0) {
        const { rows: nearby } = await pool.query<{
          bbl: string;
          house_no: string;
          count: string;
        }>(
          `SELECT bbl, house_no, COUNT(*)::text AS count
             FROM permits
            WHERE borough = $1 AND street_name = $2
            GROUP BY bbl, house_no
            ORDER BY CAST(NULLIF(house_no, '') AS INTEGER) NULLS LAST`,
          [a.borough, a.street],
        );

        if (nearby.length === 0) {
          console.info(`  No permits found on ${a.street} in ${a.borough}.`);
        } else {
          console.info(
            `  No permits at exact "${a.house} ${a.street}". ` +
              `Other house numbers on this street:`,
          );
          for (const r of nearby) {
            console.info(
              `    BBL ${r.bbl}  ${r.house_no} ${a.street}  (${r.count} active)`,
            );
          }
        }
        continue;
      }

      const bbls = [...new Set(rows.map((r) => r.bbl ?? ''))];
      console.info(
        `  ${rows.length} active permit row(s) at BBL ${bbls.join(', ')}`,
      );

      const SHOW = 8;
      for (const r of rows.slice(0, SHOW)) {
        const issued = (r.issued_date ?? '').slice(0, 10);
        const expires = (r.expired_date ?? '').slice(0, 10);
        console.info(
          `    ${(r.work_permit ?? '').padEnd(22)}  ` +
            `${(r.work_type ?? '').padEnd(34)}  ${issued} → ${expires}`,
        );
      }
      if (rows.length > SHOW) {
        console.info(`    ... and ${rows.length - SHOW} more`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
