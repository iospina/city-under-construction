// ---------------------------------------------------------------------------
// /api/og/[bbl]
// Per-parcel Open Graph image. Returns a 1200×630 PNG with the parcel's
// address, borough, active permit count, and venue alias name (when
// applicable).
//
// Runs in the Edge runtime via @vercel/og — fast cold starts and global
// distribution, since OG crawlers (Slack, iMessage, X, LinkedIn) hit this
// endpoint from anywhere in the world. Reads the permit summary from Neon
// over HTTP (no WebSocket pool, no node-specific deps).
//
// Called from render-parcel.ts via meta tag substitution:
//   <meta property="og:image" content="/api/og/{bbl}" />
//
// Caching: 1-day s-maxage. The DB only updates after the daily cron sync,
// so we can hold images at Vercel's edge for the full day.
// ---------------------------------------------------------------------------

import { ImageResponse } from '@vercel/og';
import { neon } from '@neondatabase/serverless';
import { findVenueAliasByBbl } from '../../src/services/venueAliases.js';

export const config = {
  runtime: 'edge',
};

interface ParcelSummaryRow {
  house_no: string | null;
  street_name: string | null;
  borough: string | null;
  total: number;
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Brand palette — kept in sync with src/styles/index.css and MapView marker colors.
const BLUE = '#0062CF';
const INK = '#0a0a0a';
const MUTED = '#5a5a5a';
const BG = '#fafafa';

export default async function handler(req: Request) {
  const url = new URL(req.url);
  // Extract bbl from /api/og/{bbl} — accept trailing .png for crawlers that
  // expect an explicit image extension.
  const segment = url.pathname.split('/').pop() ?? '';
  const bbl = segment.replace(/\.png$/, '');

  if (!/^\d{10}$/.test(bbl)) {
    return new Response('invalid bbl', { status: 400 });
  }

  // Best-effort DB lookup. If anything fails, we still render a generic
  // CUC-branded card rather than 500-ing — a poor preview is better than
  // a broken share link.
  let address = '';
  let borough = '';
  let permitCount = 0;
  let venueName: string | null = null;

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql`
      SELECT
        house_no,
        street_name,
        borough,
        COUNT(*) OVER ()::int AS total
      FROM permits
      WHERE bbl = ${bbl}
      LIMIT 1
    `) as ParcelSummaryRow[];

    if (rows.length > 0) {
      const r = rows[0];
      const houseNo = (r.house_no ?? '').trim();
      const streetName = (r.street_name ?? '').replace(/\s+/g, ' ').trim();
      address = [houseNo, toTitleCase(streetName)].filter(Boolean).join(' ');
      borough = r.borough ? toTitleCase(r.borough) : '';
      permitCount = r.total;
    }
  } catch (err) {
    console.error('[og] db lookup failed for bbl', bbl, err);
  }

  const alias = findVenueAliasByBbl(bbl);
  if (alias) venueName = alias.name;

  const displayHeadline = venueName || address || 'CityUnderConstruction';
  const displaySubline = venueName
    ? address
      ? `${address} · ${borough}`
      : borough
    : borough;
  const noun = permitCount === 1 ? 'permit' : 'permits';
  const permitText =
    permitCount > 0 ? `${permitCount} active ${noun}` : 'No active permits';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: BG,
          padding: '64px 72px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header: wordmark + URL */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: 28,
              color: BLUE,
              fontWeight: 600,
              letterSpacing: -0.5,
            }}
          >
            CityUnderConstruction
          </div>
          <div style={{ fontSize: 22, color: MUTED }}>
            cuc-v2.vercel.app
          </div>
        </div>

        {/* Body: headline + subline, takes remaining vertical space */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            marginTop: 40,
          }}
        >
          <div
            style={{
              fontSize: venueName ? 72 : 84,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 1056,
            }}
          >
            {displayHeadline}
          </div>
          {displaySubline ? (
            <div
              style={{
                fontSize: 34,
                color: MUTED,
                marginTop: 24,
                letterSpacing: -0.5,
              }}
            >
              {displaySubline}
            </div>
          ) : null}
        </div>

        {/* Footer: permit count chip + tagline */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              background: BLUE,
              color: 'white',
              borderRadius: 999,
              padding: '16px 32px',
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: -0.3,
            }}
          >
            {permitText}
          </div>
          <div
            style={{
              fontSize: 22,
              color: MUTED,
              textAlign: 'right',
              maxWidth: 540,
              lineHeight: 1.3,
            }}
          >
            What's being built at every NYC address
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
      },
    },
  );
}
