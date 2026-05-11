// ---------------------------------------------------------------------------
// App.tsx
// Root component. Wires together map, search, parcel detail sheet, and the
// map controls (bottom bar on mobile / floating elements on desktop).
//
// Search-to-parcel matching:
//   Mapbox's geocoder routinely falls back to a street-level centroid when
//   it doesn't have a precise point for a NYC house number. A naive
//   "closest parcel within 250m" then snaps onto whatever corner parcel
//   happens to be near that centroid — which on dense Manhattan blocks is
//   often a perpendicular-street neighbor with one unrelated permit, not
//   the parcel the user was actually looking for.
//
//   Instead we score every parcel on BOTH coord proximity AND token-level
//   address similarity (against every sub-address at the BBL, not just the
//   representative `displayAddress`), then pick from a tiered preference:
//
//     Tier 1: within 100m AND Jaccard >= 0.55 — best world
//     Tier 2: within 250m AND Jaccard >= 0.55 — slightly looser
//     Tier 3: Jaccard >= 0.55, distance ignored — text-only fallback
//             (handles parcels with no stored coords)
//     Tier 4: closest within 100m, no text requirement — last resort
//
//   Inside each tier, higher Jaccard wins; ties broken by closer distance.
//   If no tier yields a candidate the map centers on the geocoded point
//   without opening the sheet.
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { Parcel, SearchSuggestion } from './types';
import { useParcels } from './hooks/useParcels';
import { useSearch } from './hooks/useSearch';
import MapView from './components/MapView';
import SearchBar from './components/SearchBar';
import ParcelDetailSheet from './components/ParcelDetailSheet';
import { lookupBblByLatLng } from './services/geosearch';
import type { Bbox } from './services/dataService';

/**
 * Debounce delay before turning a moveend into a bbox refetch. Long enough
 * to coalesce rapid panning into a single request, short enough that the
 * permits show up before the user starts wondering where they are.
 */
const BBOX_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/** Haversine distance between two lat/lng points in metres. */
function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Tier 1 radius — tight, used to prefer same-block matches over neighbors. */
const COORD_TIGHT_RADIUS_M = 100;

/** Tier 2 / Tier 4 radius — loose. Mapbox's street centroid can land
 * 150–200m from the actual lot in dense neighborhoods. */
const COORD_LOOSE_RADIUS_M = 250;

/** Minimum Jaccard score to accept an address-text match. */
const ADDRESS_MATCH_THRESHOLD = 0.55;

/**
 * Normalise an address string for comparison:
 * lowercase, expand/collapse common abbreviations, strip punctuation.
 */
function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/\b(street)\b/g, 'st')
    .replace(/\b(avenue)\b/g, 'ave')
    .replace(/\b(boulevard)\b/g, 'blvd')
    .replace(/\b(road)\b/g, 'rd')
    .replace(/\b(drive)\b/g, 'dr')
    .replace(/\b(place)\b/g, 'pl')
    .replace(/\b(court)\b/g, 'ct')
    .replace(/\b(lane)\b/g, 'ln')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Jaccard similarity on the token sets of two normalised address strings.
 * Returns 0–1; 1 = identical token sets.
 */
function jaccardScore(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Strip a leading house number from a normalized address. House numbers
 * are positive evidence at most, never negative — a search for "124 White
 * Street" should not penalize a parcel whose sub-addresses are "120/125
 * WHITE STREET". Stripping makes Jaccard score street-name match alone;
 * house-number proximity (below) and geo distance break ties.
 *
 * Examples:
 *   "124 white st"     -> "white st"
 *   "100 east 42 st"   -> "east 42 st"   (cross-street numbers preserved)
 *   "white st"         -> "white st"
 */
function stripLeadingHouseNumber(normalizedAddr: string): string {
  return normalizedAddr.replace(/^\d+\s+/, '').trim();
}

/** Extract a leading integer from a normalized address, or null if none. */
function leadingHouseNumber(normalizedAddr: string): number | null {
  const m = normalizedAddr.match(/^(\d+)\s/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Best (minimum) house-number distance between the search and any of the
 * parcel's sub-addresses. Used as a tiebreaker after street-name Jaccard:
 * a search for "124 White" should prefer a parcel containing "120 / 125
 * White" over one containing "112 White" (numeric distance 1 vs 12), even
 * when both score 1.0 on Jaccard.
 *
 * Returns Infinity when either side has no extractable leading number,
 * effectively making this tiebreaker a no-op for those rows.
 */
function bestHouseNumberDistance(
  suggestionStreet: string,
  parcel: Parcel,
): number {
  const searchNum = leadingHouseNumber(suggestionStreet);
  if (searchNum == null) return Infinity;

  const candidates =
    parcel.subAddresses && parcel.subAddresses.length > 0
      ? parcel.subAddresses
      : [parcel.displayAddress];

  let best = Infinity;
  for (const sub of candidates) {
    const subNum = leadingHouseNumber(normalizeAddress(sub));
    if (subNum == null) continue;
    const d = Math.abs(searchNum - subNum);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Best Jaccard score between the search string and any sub-address at the
 * parcel, comparing only the street-name portion (leading house numbers
 * stripped from both sides). Falls back to `displayAddress` when
 * `subAddresses` is empty.
 */
function bestParcelJaccard(
  suggestionStreet: string,
  parcel: Parcel,
): number {
  const candidates =
    parcel.subAddresses && parcel.subAddresses.length > 0
      ? parcel.subAddresses
      : [parcel.displayAddress];

  const searchStreetOnly = stripLeadingHouseNumber(suggestionStreet);

  let best = 0;
  for (const sub of candidates) {
    const subStreetOnly = stripLeadingHouseNumber(normalizeAddress(sub));
    const score = jaccardScore(searchStreetOnly, subStreetOnly);
    if (score > best) best = score;
  }
  return best;
}

/**
 * Find the best matching Parcel for a Mapbox geocoding suggestion using a
 * tiered preference (see file header for the spec).
 */
function findMatchingParcel(
  suggestion: SearchSuggestion,
  allParcels: Parcel[],
): Parcel | null {
  const [lng, lat] = suggestion.center;

  // First comma-delimited segment of the Mapbox place_name — e.g.
  // "39 Broadway" out of "39 Broadway, Manhattan, New York, NY 10006".
  const suggestionStreet = normalizeAddress(
    suggestion.placeName.split(',')[0],
  );

  interface Scored {
    parcel: Parcel;
    distance: number;
    jaccard: number;
    houseDist: number;
  }

  // Score every candidate once.
  const scored: Scored[] = allParcels.map((p) => {
    const hasCoords = p.latitude !== 0 || p.longitude !== 0;
    const distance = hasCoords
      ? haversineMetres(lat, lng, p.latitude, p.longitude)
      : Infinity;
    const jaccard = bestParcelJaccard(suggestionStreet, p);
    const houseDist = bestHouseNumberDistance(suggestionStreet, p);
    return { parcel: p, distance, jaccard, houseDist };
  });

  // Higher Jaccard wins; closer house number is the next tiebreaker;
  // closer geo distance is the final tiebreaker.
  const orderByQuality = (a: Scored, b: Scored): number =>
    b.jaccard - a.jaccard ||
    a.houseDist - b.houseDist ||
    a.distance - b.distance;

  // Tier 1: tight radius AND meaningful text match.
  const tier1 = scored
    .filter(
      (s) =>
        s.distance <= COORD_TIGHT_RADIUS_M &&
        s.jaccard >= ADDRESS_MATCH_THRESHOLD,
    )
    .sort(orderByQuality);
  if (tier1.length > 0) return tier1[0].parcel;

  // Tier 2: loose radius AND text match.
  const tier2 = scored
    .filter(
      (s) =>
        s.distance <= COORD_LOOSE_RADIUS_M &&
        s.jaccard >= ADDRESS_MATCH_THRESHOLD,
    )
    .sort(orderByQuality);
  if (tier2.length > 0) return tier2[0].parcel;

  // Tier 3: text match alone (handles parcels without stored coords).
  const tier3 = scored
    .filter((s) => s.jaccard >= ADDRESS_MATCH_THRESHOLD)
    .sort(orderByQuality);
  if (tier3.length > 0) return tier3[0].parcel;

  // Tier 4: closest within tight radius, no text requirement (last resort).
  const tier4 = scored
    .filter((s) => s.distance <= COORD_TIGHT_RADIUS_M)
    .sort((a, b) => a.distance - b.distance);
  if (tier4.length > 0) return tier4[0].parcel;

  return null;
}

// ---------------------------------------------------------------------------
// Geolocation + URL types
// ---------------------------------------------------------------------------

type LocateState = 'idle' | 'loading' | 'denied';

/**
 * Source of the parcel-detail-sheet open. Drives the `entry_source` field
 * on PostHog's `parcel_detail_viewed` event so we can tell apart how the
 * user got here (clicked a marker / picked a search result / arrived via
 * a shared deep link).
 */
type SheetSource = 'search' | 'map' | 'share_link';

/** Parse "/parcel/{bbl}" out of a pathname. Returns null for any other path. */
function parseParcelBblFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/parcel\/(\d{10})\/?$/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export default function App() {
  // Bbox is the source of truth for which permits are loaded. It updates
  // on debounced map moveend (see handleMapReady) and gets clamped server-
  // side to NYC's extent. `loadParcelByBbl` covers BBL-specific paths that
  // don't depend on viewport (cold-start /parcel/{bbl}, popstate, search).
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const { parcels, mappableParcels, loading, error, loadParcelByBbl } =
    useParcels(bbox);
  const {
    query,
    setQuery,
    suggestions,
    clearSearch,
    loading: searchLoading,
  } = useSearch();

  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const [sheetSource, setSheetSource] = useState<SheetSource>('map');
  const mapInstanceRef = useRef<MapboxMap | null>(null);
  // State (not just ref) so the auto-fly effect re-runs when the map loads
  // after a cold-start hydration that already set selectedParcel.
  const [mapInstance, setMapInstance] = useState<MapboxMap | null>(null);

  // ---- URL routing for /parcel/{bbl} share links --------------------------
  // The URL is the source of truth for which parcel is open. On mount we
  // parse it once to figure out if we landed on a deep link; everything
  // after that is driven by selectedParcel state via pushState/popstate.
  const initialBblFromUrl = useMemo(() => parseParcelBblFromPath(window.location.pathname), []);
  const initialHydratedRef = useRef(false);

  // Hydrate from URL on mount — only fires for cold-start /parcel/{bbl} hits.
  // Fetches the parcel directly via loadParcelByBbl regardless of viewport.
  useEffect(() => {
    if (initialHydratedRef.current) return;
    initialHydratedRef.current = true;

    if (!initialBblFromUrl) return;

    loadParcelByBbl(initialBblFromUrl).then((parcel) => {
      if (parcel) {
        setSelectedParcel(parcel);
        setSheetSource('share_link');
      }
    });
  }, [initialBblFromUrl, loadParcelByBbl]);

  // Keep the URL in sync with selection state (after the initial hydration).
  useEffect(() => {
    if (!initialHydratedRef.current) return;
    const targetPath = selectedParcel ? `/parcel/${selectedParcel.bbl}` : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ bbl: selectedParcel?.bbl ?? null }, '', targetPath);
    }
  }, [selectedParcel]);

  // Browser back/forward: re-derive selection from the URL.
  useEffect(() => {
    const onPopState = async () => {
      const bbl = parseParcelBblFromPath(window.location.pathname);
      if (!bbl) {
        setSelectedParcel(null);
        return;
      }
      const parcel = await loadParcelByBbl(bbl);
      setSelectedParcel(parcel);
      if (parcel) setSheetSource('share_link');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [loadParcelByBbl]);

  // For URL-driven selection (cold-start /parcel/{bbl} or back/forward),
  // fly the map to the parcel once both the parcel AND the map are ready.
  // The search and marker-click paths fly themselves with their own padding
  // — this effect only handles share_link source so we don't double-fly.
  useEffect(() => {
    if (sheetSource !== 'share_link') return;
    if (!mapInstance || !selectedParcel) return;
    if (selectedParcel.latitude === 0 && selectedParcel.longitude === 0) return;

    const isMobile = window.innerWidth < 768;
    mapInstance.flyTo({
      center: [selectedParcel.longitude, selectedParcel.latitude],
      zoom: 16,
      padding: isMobile
        ? { top: 60, bottom: Math.round(window.innerHeight * 0.67), left: 20, right: 20 }
        : { top: 60, bottom: 60, left: 420, right: 60 },
      duration: 600,
    });
  }, [mapInstance, selectedParcel, sheetSource]);

  // ---- Saved parcel IDs state -----------------------------------------------
  const [savedParcelIds, setSavedParcelIds] = useState<Set<string>>(() => {
    try {
      return new Set(
        Object.keys(localStorage)
          .filter(k => k.startsWith('cuc_saved_') && localStorage.getItem(k) === 'true')
          .map(k => k.replace('cuc_saved_', ''))
      );
    } catch {
      return new Set();
    }
  });

  const handleBookmarkToggle = useCallback((parcelId: string, saved: boolean) => {
    setSavedParcelIds(prev => {
      const next = new Set(prev);
      if (saved) next.add(parcelId); else next.delete(parcelId);
      return next;
    });
  }, []);

  // ---- User location state --------------------------------------------------
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  // ---- Geolocation ---------------------------------------------------------
  const [locateState, setLocateState] = useState<LocateState>('idle');

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) return;

    setLocateState('loading');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        setUserLocation([longitude, latitude]);
        mapInstanceRef.current?.flyTo({
          center: [longitude, latitude],
          zoom: 14,
          duration: 600,
        });
        setLocateState('idle');
      },
      () => {
        setLocateState('denied');
        setTimeout(() => setLocateState('idle'), 2500);
      },
      { timeout: 10_000 },
    );
  }, []);

  const locateBtnClass = [
    'cuc-locate-btn',
    locateState === 'loading' ? 'cuc-locate-btn--loading' : '',
    locateState === 'denied' ? 'cuc-locate-btn--denied' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const locateLabel =
    locateState === 'loading'
      ? 'Getting your location…'
      : locateState === 'denied'
        ? 'Location unavailable'
        : 'Center on my location';

  // ---- Map ready callback --------------------------------------------------
  // Wires up viewport-aware data fetching: every moveend coalesces (after a
  // BBOX_DEBOUNCE_MS quiet period) into a single setBbox, which triggers a
  // new /api/parcels?bbox=... fetch in useParcels.
  const handleMapReady = useCallback((map: MapboxMap) => {
    mapInstanceRef.current = map;
    setMapInstance(map);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const pushCurrentBbox = () => {
      const b = map.getBounds();
      if (!b) return;
      setBbox({
        minLng: b.getWest(),
        minLat: b.getSouth(),
        maxLng: b.getEast(),
        maxLat: b.getNorth(),
      });
    };
    const onMoveEnd = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(pushCurrentBbox, BBOX_DEBOUNCE_MS);
    };

    // Initial fetch immediately (no debounce — the user is already looking
    // at the map and we want markers on it as fast as possible).
    pushCurrentBbox();
    map.on('moveend', onMoveEnd);
  }, []);

  // ---- Marker click --------------------------------------------------------
  // ParcelDetailSheet's effect fires `parcel_detail_viewed` with the
  // appropriate entry_source on every open, so we don't fire any
  // analytics here directly.
  const handleMarkerClick = useCallback((parcel: Parcel) => {
    setSelectedParcel(parcel);
    setSheetSource('map');

    // Mobile-aware marker click flyTo
    const isMobile = window.innerWidth < 768;
    mapInstanceRef.current?.flyTo({
      center: [parcel.longitude, parcel.latitude],
      zoom: mapInstanceRef.current.getZoom() < 15 ? 15 : mapInstanceRef.current.getZoom(),
      padding: isMobile
        ? { top: 60, bottom: Math.round(window.innerHeight * 0.67), left: 20, right: 20 }
        : { top: 60, bottom: 60, left: 420, right: 60 },
      duration: 400,
    });
  }, []);

  // ---- Search result selected ----------------------------------------------
  // Two-track resolution: NYC GeoSearch reverse lookup is the authoritative
  // resolver for "what BBL is at this lat/lng" — fixes cross-street filings
  // like Project Commodore at "175 Park Avenue" that DOB actually files at
  // "122 EAST 42 STREET". A local text-token match runs in parallel against
  // whatever parcels are currently loaded as a viewport-local fallback
  // (degraded since the bbox migration — only succeeds when the target is
  // already in the loaded set, but harmless when it isn't because GeoSearch
  // covers the cross-viewport case).
  //
  // For an alias suggestion (`alias:{bbl}`) we resolve directly via
  // loadParcelByBbl regardless of viewport — venue names that span multiple
  // BBLs (e.g., "Pacific Park") shouldn't snap to whatever BBL happens to
  // be closest to the development's centroid.
  const handleSearchSelect = useCallback(
    async (suggestion: SearchSuggestion) => {
      const [lng, lat] = suggestion.center;

      let matched: Parcel | null = null;

      if (suggestion.id.startsWith('alias:')) {
        const aliasBbl = suggestion.id.slice('alias:'.length);
        matched = await loadParcelByBbl(aliasBbl);
      } else {
        // Standard path: kick off GeoSearch in parallel with the local
        // text-token match against currently-loaded parcels.
        const geoBblPromise = lookupBblByLatLng(lat, lng);
        const textMatch = findMatchingParcel(suggestion, parcels);

        const geoBbl = await geoBblPromise;
        if (geoBbl) {
          matched = await loadParcelByBbl(geoBbl);
        }
        if (!matched) matched = textMatch;
      }

      if (matched) {
        // Fly to the matched parcel's stored coords if available, otherwise
        // use the geocoded coordinates.
        const flyLng = matched.longitude !== 0 ? matched.longitude : lng;
        const flyLat = matched.latitude !== 0 ? matched.latitude : lat;

        mapInstanceRef.current?.flyTo({
          center: [flyLng, flyLat],
          zoom: 16,
          duration: 400,
        });

        // parcel_detail_viewed is emitted by ParcelDetailSheet's effect.
        setSelectedParcel(matched);
        setSheetSource('search');
      } else {
        // No parcel match — still pan the map to the geocoded location.
        mapInstanceRef.current?.flyTo({
          center: [lng, lat],
          zoom: 16,
          duration: 400,
        });
      }

      clearSearch();
    },
    [parcels, clearSearch, loadParcelByBbl],
  );

  // ---- Close sheet ---------------------------------------------------------
  const handleCloseSheet = useCallback(() => {
    setSelectedParcel(null);
  }, []);

  return (
    <div className={`cuc-app${selectedParcel ? ' cuc-app--sheet-open' : ''}`}>
      {/* Map — always behind everything */}
      <MapView
        parcels={mappableParcels}
        selectedParcelId={selectedParcel?.parcelId ?? null}
        savedParcelIds={savedParcelIds}
        userLocation={userLocation}
        onMarkerClick={handleMarkerClick}
        onMapReady={handleMapReady}
      />

      {/* ---- Bottom bar -------------------------------------------------------
           Mobile:  fixed at the bottom of the screen.
                    Contains search and locate button in a row.
           Desktop: repositioned by CSS to float top-left as a search container.
                    Slides off-screen when panel is open.
      ----------------------------------------------------------------------- */}
      <div className={`cuc-bottom-bar${selectedParcel ? ' cuc-bottom-bar--panel-open' : ''}`}>
        <div className="cuc-search-row">
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            suggestions={suggestions}
            onSelect={handleSearchSelect}
            onClear={clearSearch}
            loading={searchLoading}
          />
          <button
            className={locateBtnClass}
            onClick={handleLocate}
            aria-label={locateLabel}
            title={locateLabel}
            disabled={locateState === 'loading'}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontVariationSettings:
                  locateState === 'loading'
                    ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
                    : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
              }}
            >
              {locateState === 'denied' ? 'location_disabled' : 'my_location'}
            </span>
          </button>
        </div>
      </div>

      {/* Loading / error indicators */}
      {loading && <div className="cuc-loading">Loading permits…</div>}
      {error && <div className="cuc-error">Error: {error}</div>}

      {/* Parcel detail sheet — conditional */}
      {selectedParcel && (
        <ParcelDetailSheet
          parcel={selectedParcel}
          source={sheetSource}
          onClose={handleCloseSheet}
          onBookmarkToggle={handleBookmarkToggle}
        />
      )}

      {/* Attribution — bottom-left, beside Mapbox attribution */}
      <div className="cuc-attribution">
        <span>Built by </span>
        <a
          href="https://ignacioospina.com"
          target="_blank"
          rel="noopener noreferrer"
          className="cuc-attribution-link"
        >
          Ignacio Ospina
        </a>
        <a
          href="https://www.linkedin.com/in/ignacioospina/"
          target="_blank"
          rel="noopener noreferrer"
          className="cuc-attribution-linkedin"
          aria-label="LinkedIn"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
        </a>
      </div>
    </div>
  );
}
