// ---------------------------------------------------------------------------
// /api/cron/sync-permits
// Vercel Cron handler. Triggered daily by the schedule in vercel.json.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. We verify before
// doing any work so accidental public hits can't trigger a sync.
//
// All real work lives in lib/sync.ts so the same code path is exercisable
// from a local CLI script (scripts/sync.ts).
// ---------------------------------------------------------------------------

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runSync } from '../../lib/sync.js';

export const config = { maxDuration: 300 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await runSync();
    console.info(
      `[sync-permits] ok rows=${result.rowsSynced} ` +
        `pages=${result.pagesFetched} ms=${result.durationMs}`,
    );
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync-permits] failed:', message);
    return res.status(500).json({ ok: false, error: message });
  }
}
