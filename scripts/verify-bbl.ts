// ---------------------------------------------------------------------------
// scripts/verify-bbl.ts
// Diagnostic: print every permit currently in the City Permits database at a BBL.
//
//   npm run db:verify -- 3029770001        # 140 Stewart Avenue (Brooklyn Mirage)
//   npm run db:verify -- 1001880001        # 124 White Street    (Chinatown Jail)
//   npm run db:verify -- 1012970001        # 175 Park Avenue     (RXR/TF supertall)
//
// Without an argument, defaults to 140 Stewart Avenue.
//
// The expected counts come from the May 2026 audit. If a BBL returns far
// fewer rows than expected, the most likely cause is the sync didn't run,
// the BBL changed, or DOB NOW is mid-update. If it matches, the row-cap
// fix is doing its job.
// ---------------------------------------------------------------------------

import { Pool } from '@neondatabase/serverless';

const DEFAULT_BBL = '3029770001'; // 140 Stewart Avenue, Brooklyn

interface PermitRow {
  work_permit: string | null;
  work_type: string | null;
  permit_status: string | null;
  issued_date: string | null;
  expired_date: string | null;
  house_no: string | null;
  street_name: string | null;
  job_description: string | null;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local.');
  }

  const bbl = (process.argv[2] ?? DEFAULT_BBL).trim();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<PermitRow>(
      `SELECT work_permit, work_type, permit_status,
              issued_date, expired_date,
              house_no, street_name, job_description
         FROM permits
        WHERE bbl = $1
        ORDER BY issued_date DESC`,
      [bbl],
    );

    console.info(`BBL ${bbl}: ${rows.length} active permit row(s)\n`);

    for (const r of rows) {
      const addr = [r.house_no, r.street_name].filter(Boolean).join(' ');
      const issued = (r.issued_date ?? '').slice(0, 10);
      const expires = (r.expired_date ?? '').slice(0, 10);
      const desc = (r.job_description ?? '').slice(0, 80);
      console.info(
        `  ${(r.work_permit ?? '').padEnd(22)}  ` +
          `${(r.work_type ?? '').padEnd(28)}  ` +
          `${issued} → ${expires}  ` +
          `${addr.padEnd(20)}  ${desc}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
