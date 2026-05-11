// ---------------------------------------------------------------------------
// /api/og/[bbl]
// Per-parcel Open Graph image. Returns a 1200×630 PNG with the parcel's
// address, borough, active permit count, venue alias name (when applicable),
// and a Mapbox static map of the parcel's actual location.
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
  latitude: string | null;
  longitude: string | null;
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

// OG image dimensions.
const W = 1200;
const H = 630;
// Right half holds the map; left half holds the text.
const MAP_W = 600;
const TEXT_W = W - MAP_W;

/**
 * Build a Mapbox Static Images URL centered on the parcel with a pin at the
 * exact coordinates. Style matches the in-app map (light-v11). Returns null
 * if any input is missing — the JSX falls back to a typography-only layout.
 */
function buildMapUrl(
  lat: number,
  lng: number,
  token: string,
): string {
  // pin-l = large pin, +HEX = colour. Mapbox draws this on top of the map.
  const overlay = `pin-l+${BLUE.replace('#', '')}(${lng},${lat})`;
  // zoom 15 shows roughly a block in NYC. @2x doubles pixel density for
  // crisper rendering on retina displays.
  return (
    `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${overlay}` +
    `/${lng},${lat},15/${MAP_W}x${H}@2x?access_token=${token}`
  );
}

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
  let lat: number | null = null;
  let lng: number | null = null;

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql`
      SELECT
        house_no,
        street_name,
        borough,
        latitude,
        longitude,
        COUNT(*) OVER ()::int AS total
      FROM permits
      WHERE bbl = ${bbl}
        AND latitude  ~ '^-?[0-9]+(\.[0-9]+)?$'
        AND longitude ~ '^-?[0-9]+(\.[0-9]+)?$'
      LIMIT 1
    `) as ParcelSummaryRow[];

    if (rows.length > 0) {
      const r = rows[0];
      const houseNo = (r.house_no ?? '').trim();
      const streetName = (r.street_name ?? '').replace(/\s+/g, ' ').trim();
      address = [houseNo, toTitleCase(streetName)].filter(Boolean).join(' ');
      borough = r.borough ? toTitleCase(r.borough) : '';
      permitCount = r.total;
      const parsedLat = Number(r.latitude);
      const parsedLng = Number(r.longitude);
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
        lat = parsedLat;
        lng = parsedLng;
      }
    }
  } catch (err) {
    console.error('[og] db lookup failed for bbl', bbl, err);
  }

  const alias = findVenueAliasByBbl(bbl);
  const venueName = alias ? alias.name : null;

  // If the DB row had no coords but the alias entry has approximate ones,
  // use those — Pacific Park and Chinatown jail both have centroid coords
  // baked into the alias table for cases where the rep row lacks geocoding.
  if ((lat === null || lng === null) && alias) {
    [lng, lat] = alias.center;
  }

  const mapboxToken = process.env.VITE_MAPBOX_ACCESS_TOKEN;
  const mapUrl =
    lat !== null && lng !== null && mapboxToken
      ? buildMapUrl(lat, lng, mapboxToken)
      : null;

  const displayHeadline = venueName || address || 'CityUnderConstruction';
  const displaySubline = venueName
    ? address
      ? `${address} · ${borough}`
      : borough
    : borough;
  const noun = permitCount === 1 ? 'permit' : 'permits';
  const permitText =
    permitCount > 0 ? `${permitCount} active ${noun}` : 'No active permits';

  // Headline sizing: scales down when the venue name is present (longer
  // text) so it fits comfortably in the left-half text column.
  const headlineFontSize = venueName ? 56 : 64;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          background: BG,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* ---- Left column: text content -------------------------------- */}
        <div
          style={{
            width: TEXT_W,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '52px 48px',
          }}
        >
          {/* Wordmark */}
          <div
            style={{
              fontSize: 24,
              color: BLUE,
              fontWeight: 600,
              letterSpacing: -0.5,
            }}
          >
            CityUnderConstruction
          </div>

          {/* Headline + subline take the remaining vertical space */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                fontSize: headlineFontSize,
                fontWeight: 700,
                color: INK,
                lineHeight: 1.05,
                letterSpacing: -1.5,
              }}
            >
              {displayHeadline}
            </div>
            {displaySubline ? (
              <div
                style={{
                  fontSize: 26,
                  color: MUTED,
                  marginTop: 16,
                  letterSpacing: -0.3,
                }}
              >
                {displaySubline}
              </div>
            ) : null}
          </div>

          {/* Footer: permit count pill */}
          <div style={{ display: 'flex' }}>
            <div
              style={{
                background: BLUE,
                color: 'white',
                borderRadius: 999,
                padding: '14px 28px',
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: -0.3,
              }}
            >
              {permitText}
            </div>
          </div>
        </div>

        {/* ---- Right column: Mapbox static map -------------------------- */}
        {/* Fallback: if no map URL, render a tinted panel with the BBL.
            Keeps the layout balanced rather than leaving a white void. */}
        <div
          style={{
            width: MAP_W,
            height: '100%',
            display: 'flex',
            position: 'relative',
          }}
        >
          {mapUrl ? (
            <img
              src={mapUrl}
              width={MAP_W}
              height={H}
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#eef3f9',
                color: MUTED,
                fontSize: 22,
                letterSpacing: -0.3,
              }}
            >
              BBL {bbl}
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
      },
    },
  );
}
