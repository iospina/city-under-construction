// ---------------------------------------------------------------------------
// /api/render-parcel
// Server-rendered HTML wrapper for /parcel/{bbl} share links.
//
// Why we need this:
//   Social-media link unfurlers (LinkedIn, iMessage, Twitter, Slack,
//   Reddit) do NOT execute JavaScript when scraping for Open Graph
//   metadata. They fetch the URL once, parse the HTML response, and read
//   `og:title` / `og:description` / `og:image` straight out of the static
//   markup. So per-parcel preview cards require server-side substitution
//   of those tags before the SPA bundle even runs.
//
// How it works:
//   In production, vercel.json rewrites every /parcel/(.*) request to
//   /api/render-parcel?bbl=$1. This handler:
//     1. Reads the post-build index.html (falls back to source index.html
//        in dev).
//     2. Looks up a quick parcel summary in Postgres: representative
//        address + total active-permit count.
//     3. Substitutes per-parcel OG/Twitter meta tags into the HTML.
//     4. Returns the modified HTML so the SPA bundle hydrates normally
//        once the browser parses it.
//
//   For an unknown / malformed BBL, we serve the unmodified index.html
//   (the SPA itself will handle the missing-parcel case at hydration time).
// ---------------------------------------------------------------------------

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from '../lib/db.js';
import { findVenueAliasByBbl } from '../src/services/venueAliases.js';

interface ParcelSummaryRow {
  house_no: string | null;
  street_name: string | null;
  borough: string | null;
  total: number;
}

let cachedDistHtml: string | null = null;

/**
 * Get the base HTML to wrap with parcel-specific OG tags.
 *
 * Production (after `vite build`): reads dist/index.html from disk, which
 * has the post-build hashed asset references and needs no transforms. We
 * cache it once per cold-start because it doesn't change between requests.
 *
 * Development (`vercel dev`): fetches the same-origin / from the dev
 * server. Vite transforms the source index.html on every request to
 * inject the React Fast Refresh preamble and the @vite/client HMR
 * runtime; a plain readFileSync on the source HTML would skip those
 * transforms and break SPA hydration. We do NOT cache the dev HTML
 * because Vite's transforms can change between restarts.
 */
async function getBaseHtml(req: VercelRequest): Promise<string> {
  // Production path: bundled dist/index.html.
  if (cachedDistHtml !== null) return cachedDistHtml;

  const distPath = resolve(process.cwd(), 'dist/index.html');
  if (existsSync(distPath)) {
    cachedDistHtml = readFileSync(distPath, 'utf-8');
    return cachedDistHtml;
  }

  // Dev path: fetch the framework-served HTML from the same origin so
  // we pick up Vite's transforms.
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host =
    (req.headers['x-forwarded-host'] as string | undefined) ??
    (req.headers.host as string | undefined) ??
    'localhost:3000';
  const url = `${proto}://${host}/`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `render-parcel: dev base HTML fetch failed at ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Replace a meta tag with the given selector. Idempotent — if the tag
 * is missing from the source HTML, we leave the HTML unchanged rather
 * than silently inject a partial tag.
 */
function replaceMeta(
  html: string,
  pattern: RegExp,
  replacement: string,
): string {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function deriveOriginFromRequest(req: VercelRequest): string {
  // Vercel sets x-forwarded-host / x-forwarded-proto on edge routes.
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
  const host =
    (req.headers['x-forwarded-host'] as string | undefined) ??
    (req.headers.host as string | undefined) ??
    'cityunderconstruction.nyc';
  return `${proto}://${host}`;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const bbl = String(req.query.bbl ?? '').trim();
  const isValidBbl = /^\d{10}$/.test(bbl);

  let html: string;
  try {
    html = await getBaseHtml(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[render-parcel] template load failed:', message);
    res.status(500).send(`Template error: ${message}`);
    return;
  }

  if (isValidBbl) {
    try {
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
        const addr = [houseNo, streetName].filter(Boolean).join(' ');
        const borough = r.borough ? toTitleCase(r.borough) : '';
        const total = r.total;
        const noun = total === 1 ? 'permit' : 'permits';

        // If this BBL is in our hand-curated venue alias table (Brooklyn
        // Mirage, Pacific Park, etc.), use its recognizable display name
        // for the share card instead of whichever sub-address the rep
        // row happens to surface (e.g., "135 Washington Walk").
        const alias = findVenueAliasByBbl(bbl);
        const ogTitle = alias
          ? `${alias.name}, ${alias.borough}`
          : borough
          ? `${addr}, ${borough}`
          : addr || 'CityUnderConstruction';
        const ogDescription = `${total} active construction ${noun} at this address. CityUnderConstruction shows the public DOB record for what's actually being built across NYC.`;
        const origin = deriveOriginFromRequest(req);
        const ogUrl = `${origin}/parcel/${bbl}`;

        html = replaceMeta(
          html,
          /<title>[^<]*<\/title>/,
          `<title>${escapeHtml(`${ogTitle} — ${total} active ${noun} | CityUnderConstruction`)}</title>`,
        );
        html = replaceMeta(
          html,
          /<meta name="description"[^>]*\/?>/i,
          `<meta name="description" content="${escapeAttr(ogDescription)}" />`,
        );
        html = replaceMeta(
          html,
          /<meta property="og:title"[^>]*\/?>/i,
          `<meta property="og:title" content="${escapeAttr(ogTitle)}" />`,
        );
        html = replaceMeta(
          html,
          /<meta property="og:description"[^>]*\/?>/i,
          `<meta property="og:description" content="${escapeAttr(ogDescription)}" />`,
        );
        html = replaceMeta(
          html,
          /<meta property="og:url"[^>]*\/?>/i,
          `<meta property="og:url" content="${escapeAttr(ogUrl)}" />`,
        );
        html = replaceMeta(
          html,
          /<meta name="twitter:title"[^>]*\/?>/i,
          `<meta name="twitter:title" content="${escapeAttr(ogTitle)}" />`,
        );
        html = replaceMeta(
          html,
          /<meta name="twitter:description"[^>]*\/?>/i,
          `<meta name="twitter:description" content="${escapeAttr(ogDescription)}" />`,
        );
      }
    } catch (err) {
      // DB read failed — log and serve the unmodified template. Better
      // a generic preview card than a 500 for a share link.
      console.error('[render-parcel] db summary failed for bbl', bbl, err);
    }
  }

  // 5-minute fresh window, 15-minute stale-while-revalidate. The underlying
  // permit summary only changes when the daily cron runs, so this is safe.
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=300, stale-while-revalidate=900',
  );
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
