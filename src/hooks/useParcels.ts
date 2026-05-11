// ---------------------------------------------------------------------------
// useParcels.ts
// Viewport-aware permit data hook.
//
// Strategy: each time the bbox prop changes, fetch /api/parcels?bbox=...
// and merge the returned parcels into an accumulating Map<bbl, Parcel> cache.
// Parcels the user has already loaded stick around as they pan, so a backpan
// to a previously-visited area doesn't re-fetch and the markers don't flicker.
//
// Imperative `loadParcelByBbl` covers paths that need a specific parcel
// regardless of viewport — cold-start `/parcel/{bbl}` hydration, browser
// back/forward to a deep link, and resolving venue-alias / GeoSearch BBLs
// from the search flow.
//
// NYC bbox cap: the server rejects bboxes larger than 1° in either
// dimension. At very low zoom the map's getBounds() can exceed that, so
// we clamp the request to NYC's actual extent (~0.56° × 0.43°), which
// safely fits under the cap and contains every permit anyway.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Parcel, RawPermitRow } from '../types';
import {
  fetchPermitRowsInBbox,
  fetchPermitRowsForBbl,
  type Bbox,
} from '../services/dataService';
import { groupRowsIntoParcels } from '../services/parcelGrouping';

// NYC's geographic extent (rounded outward for safety). Any reasonable
// citywide view fits inside; anything bigger gets clamped here.
const NYC_BBOX: Bbox = {
  minLng: -74.260,
  minLat: 40.490,
  maxLng: -73.700,
  maxLat: 40.920,
};

interface UseParcelsResult {
  parcels: Parcel[];
  /** Parcels with valid lat/lng AND at least one active permit. Map renders these. */
  mappableParcels: Parcel[];
  loading: boolean;
  error: string | null;
  /**
   * Imperatively load a single parcel by BBL — useful when the BBL of
   * interest may be outside the current viewport (share-link cold start,
   * browser back/forward to a /parcel/{bbl} URL, alias resolution from
   * search). Caches the result in the same backing store as bbox fetches,
   * so the parcel becomes part of the regular `parcels` list immediately.
   */
  loadParcelByBbl: (bbl: string) => Promise<Parcel | null>;
}

/**
 * Clamp `bbox` to NYC's extent. Returns null if the bbox is degenerate or
 * lies entirely outside NYC (no fetch needed in that case).
 */
function clampToNyc(bbox: Bbox): Bbox | null {
  const minLng = Math.max(bbox.minLng, NYC_BBOX.minLng);
  const minLat = Math.max(bbox.minLat, NYC_BBOX.minLat);
  const maxLng = Math.min(bbox.maxLng, NYC_BBOX.maxLng);
  const maxLat = Math.min(bbox.maxLat, NYC_BBOX.maxLat);
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}

export function useParcels(bbox: Bbox | null): UseParcelsResult {
  // Map<bbl, Parcel> — accumulating cache. New rows from bbox or single-BBL
  // fetches upsert into this map. We never evict; permits stick around
  // across pans within a session.
  const [parcelsByBbl, setParcelsByBbl] = useState<Map<string, Parcel>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latch the latest bbox key so concurrent requests resolve in order — a
  // late response from an earlier bbox shouldn't clobber state if the user
  // has already panned away.
  const inflightKeyRef = useRef<string>('');

  // Ref mirror of parcelsByBbl so `loadParcelByBbl` can read the latest
  // cache without taking parcelsByBbl as a dep (which would re-create the
  // callback on every map pan and force consumers to re-subscribe).
  const parcelsByBblRef = useRef(parcelsByBbl);
  parcelsByBblRef.current = parcelsByBbl;

  const mergeRows = useCallback((rows: RawPermitRow[]) => {
    if (rows.length === 0) return;
    const grouped = groupRowsIntoParcels(rows);
    setParcelsByBbl((prev) => {
      const next = new Map(prev);
      for (const p of grouped) next.set(p.bbl, p);
      return next;
    });
  }, []);

  // ---- Viewport fetch on bbox change --------------------------------------
  useEffect(() => {
    if (!bbox) return;
    const clamped = clampToNyc(bbox);
    if (!clamped) return;

    const key = `${clamped.minLng},${clamped.minLat},${clamped.maxLng},${clamped.maxLat}`;
    inflightKeyRef.current = key;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchPermitRowsInBbox(clamped)
      .then((rows) => {
        if (cancelled) return;
        if (inflightKeyRef.current !== key) return; // stale response
        mergeRows(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // The four numeric bbox properties are the real dependencies — using
    // bbox-object identity would re-fetch on every render since App.tsx
    // builds a fresh bbox object on each map move.
  }, [bbox?.minLng, bbox?.minLat, bbox?.maxLng, bbox?.maxLat, mergeRows]);

  // ---- Imperative single-BBL loader ---------------------------------------
  // Stable across renders — reads the live cache via parcelsByBblRef so
  // callers (App.tsx effect dep arrays, popstate handler) don't need to
  // re-bind on every map pan.
  const loadParcelByBbl = useCallback(
    async (bbl: string): Promise<Parcel | null> => {
      const cached = parcelsByBblRef.current.get(bbl);
      if (cached) return cached;

      try {
        const rows = await fetchPermitRowsForBbl(bbl);
        if (rows.length === 0) return null;
        const grouped = groupRowsIntoParcels(rows);
        const parcel = grouped[0] ?? null;
        if (parcel) {
          setParcelsByBbl((prev) => {
            const next = new Map(prev);
            next.set(parcel.bbl, parcel);
            return next;
          });
        }
        return parcel;
      } catch (err) {
        // Don't promote to component-level error state — a failed single
        // BBL fetch shouldn't take down the whole map. Caller decides.
        console.warn(`[useParcels] loadParcelByBbl(${bbl}) failed:`, err);
        return null;
      }
    },
    [],
  );

  // ---- Derived projections ------------------------------------------------
  const parcels = useMemo(
    () => Array.from(parcelsByBbl.values()),
    [parcelsByBbl],
  );

  const mappableParcels = useMemo(
    () =>
      parcels.filter(
        (p) => p.latitude !== 0 && p.longitude !== 0 && p.hasActivePermit,
      ),
    [parcels],
  );

  return { parcels, mappableParcels, loading, error, loadParcelByBbl };
}
