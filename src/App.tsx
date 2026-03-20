// ---------------------------------------------------------------------------
// App.tsx
// Root component. Wires together map, search, parcel detail sheet, and the
// map controls (bottom bar on mobile / floating elements on desktop).
//
// Search-to-parcel matching:
//   Two-strategy approach so results aren't gated by a brittle single radius:
//
//   Strategy A — coordinate proximity on all parcels with valid coords,
//                using 250m radius (relaxed from 100m).
//   Strategy B — normalised address text matching on ALL parcels (including
//                those without stored coordinates), Jaccard token similarity.
//
//   If neither strategy yields a confident match, the map centers on the
//   geocoded location without opening the sheet.
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { Parcel, SearchSuggestion } from './types';
import { useParcels } from './hooks/useParcels';
import { useSearch } from './hooks/useSearch';
import MapView from './components/MapView';
import SearchBar from './components/SearchBar';
import ParcelDetailSheet from './components/ParcelDetailSheet';
import { track, AnalyticsEvents } from './services/analytics';

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

/** Max distance (m) for coordinate-based match. Relaxed to 250m. */
const COORD_MATCH_RADIUS_M = 250;

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
 * Find the best matching Parcel for a Mapbox geocoding suggestion.
 *
 * Strategy A: coordinate proximity on parcels that have stored coords.
 * Strategy B: normalised address text match on ALL parcels (fallback).
 */
function findMatchingParcel(
  suggestion: SearchSuggestion,
  allParcels: Parcel[],
): Parcel | null {
  const [lng, lat] = suggestion.center;

  // --- Strategy A: coordinate proximity -----------------------------------
  let closestByCoord: Parcel | null = null;
  let closestDist = Infinity;

  for (const p of allParcels) {
    if (p.latitude === 0 && p.longitude === 0) continue;
    const d = haversineMetres(lat, lng, p.latitude, p.longitude);
    if (d < closestDist) {
      closestDist = d;
      closestByCoord = p;
    }
  }

  if (closestByCoord && closestDist <= COORD_MATCH_RADIUS_M) {
    return closestByCoord;
  }

  // --- Strategy B: normalised address text match --------------------------
  // Use the first comma-delimited segment of the Mapbox place_name
  // (e.g. "39 Broadway" from "39 Broadway, Manhattan, New York, NY 10006 …")
  const suggestionStreet = normalizeAddress(suggestion.placeName.split(',')[0]);

  let bestAddressMatch: Parcel | null = null;
  let bestScore = 0;

  for (const p of allParcels) {
    const normParcel = normalizeAddress(p.displayAddress);
    const score = jaccardScore(suggestionStreet, normParcel);
    if (score > bestScore) {
      bestScore = score;
      bestAddressMatch = p;
    }
  }

  if (bestAddressMatch && bestScore >= ADDRESS_MATCH_THRESHOLD) {
    return bestAddressMatch;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Geolocation types
// ---------------------------------------------------------------------------

type LocateState = 'idle' | 'loading' | 'denied';

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export default function App() {
  // Use ALL parcels for matching; mappableParcels only for rendering markers.
  const { parcels, mappableParcels, loading, error } = useParcels();
  const {
    query,
    setQuery,
    suggestions,
    clearSearch,
    loading: searchLoading,
  } = useSearch();

  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const [sheetSource, setSheetSource] = useState<'search' | 'map'>('map');
  const mapInstanceRef = useRef<MapboxMap | null>(null);

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
  const handleMapReady = useCallback((map: MapboxMap) => {
    mapInstanceRef.current = map;
  }, []);

  // ---- Marker click --------------------------------------------------------
  const handleMarkerClick = useCallback((parcel: Parcel) => {
    track(AnalyticsEvents.PARCEL_SHEET_OPENED_FROM_MAP, {
      parcelId: parcel.parcelId,
    });
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
  const handleSearchSelect = useCallback(
    (suggestion: SearchSuggestion) => {
      const [lng, lat] = suggestion.center;

      // Try to match against ALL parcels (not just mappable ones)
      const matched = findMatchingParcel(suggestion, parcels);

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

        track(AnalyticsEvents.PARCEL_SHEET_OPENED_FROM_SEARCH, {
          parcelId: matched.parcelId,
        });
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
    [parcels, clearSearch],
  );

  // ---- Close sheet ---------------------------------------------------------
  const handleCloseSheet = useCallback(() => {
    setSelectedParcel(null);
  }, []);

  return (
    <div className="cuc-app">
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
